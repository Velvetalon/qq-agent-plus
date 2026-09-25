import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DEFAULT_CONFIG, setRuntimeConfig } from '../../../src/core/config.js';
import { ChatStore } from '../../../src/core/store.js';
import { OneBotActionError } from '../../../src/onebot/onebot.js';
import { SendQueue } from '../../../src/onebot/sender.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-p8-sender-boundary-'));
const store = new ChatStore(0, { dataDir: root });

try {
  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.runtime.mode = 'active';
  cfg.allow.groups = ['8001'];
  cfg.send.minGapMs = 0;
  cfg.send.maxGapMs = 0;
  cfg.send.maxPerMinute = 100;
  cfg.send.maxPerHour = 100;
  setRuntimeConfig(cfg);

  let unknownCalls = 0;
  const unknownSender = new SendQueue({
    store,
    onebot: {
      async sendText() {
        unknownCalls += 1;
        throw new Error('HTTP response lost after remote delivery');
      }
    }
  });

  await assert.rejects(
    unknownSender.sendTextBatch('group:8001', ['unknown delivery'], { runId: 'run-unknown' }),
    /response lost/
  );
  assert.equal(unknownCalls, 1);
  assert.equal(store.hasUncertainEffects('run-unknown'), true);
  assert.deepEqual(
    store.listRunEffects('run-unknown').map((effect) => effect.state),
    ['unknown']
  );

  await assert.rejects(
    unknownSender.sendTextBatch('group:8001', ['must not retry'], { runId: 'run-unknown' }),
    /delivery is uncertain/
  );
  assert.equal(unknownCalls, 1, 'an unknown delivery must block automatic retry');

  let definiteCalls = 0;
  const definiteSender = new SendQueue({
    store,
    onebot: {
      async sendText() {
        definiteCalls += 1;
        throw new OneBotActionError('retcode=100 failed to resolve UID', {
          action: 'send_group_msg',
          outcome: 'failed',
          retcode: 100
        });
      }
    }
  });

  await assert.rejects(
    definiteSender.sendTextBatch('group:8001', ['definite rejection'], { runId: 'run-definite' }),
    /retcode=100/
  );
  assert.equal(definiteCalls, 1);
  assert.equal(store.hasUncertainEffects('run-definite'), false);
  assert.deepEqual(
    store.listRunEffects('run-definite').map((effect) => effect.state),
    ['failed']
  );

  console.log(JSON.stringify({
    status: 'PASS',
    unknownDelivery: {
      calls: unknownCalls,
      outboxState: 'unknown',
      automaticRetryBlocked: true
    },
    definiteRejection: {
      calls: definiteCalls,
      outboxState: 'failed',
      retryable: true
    }
  }, null, 2));
} finally {
  store.close();
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    console.warn(`temporary cleanup warning: ${error.message}`);
  }
}
