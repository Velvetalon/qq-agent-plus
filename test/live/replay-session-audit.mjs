/** Read only sessions created by this wake/tick, never the registry's old latest. */
export function collectNewSessionAudit(beforeIds, summaries, getSession) {
 const created=summaries.filter(s=>!beforeIds.has(String(s.id))).map(s=>getSession(s.id)).filter(Boolean);
 const selected=created.find(s=>s.socialAudit)||null;
 return {
  sessionId:selected?.id||null,
  createdSessionIds:created.map(s=>s.id),
  sessions:created.map(s=>({id:s.id,status:s.status,finishReason:s.finishReason??null,socialAudit:s.socialAudit??null,error:s.error??null,budgetStopped:s.budgetStopped===true,roundBudgetStopped:s.roundBudgetStopped===true})),
  socialAudit:selected?.socialAudit??null,finishReason:selected?.finishReason??null,error:selected?.error??null,
  outbound:selected?.outbound??null,retrieval:selected?.retrieval??null,pluginContext:selected?.pluginContext??null
 };
}
