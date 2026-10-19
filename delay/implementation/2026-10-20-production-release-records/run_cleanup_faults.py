raise SystemExit('Archived snapshot only')
import argparse,ast,hashlib,io,json,os,pathlib,runpy,unittest
p=argparse.ArgumentParser();p.add_argument('--operator-source',default=str(pathlib.Path(__file__).with_name('apply-update.sh')));p.add_argument('--report',default=r'E:\Code\qq-agent-plus\delay\schedule\evidence\2026-10-20-workflow-resume\luna-fault-tests.json');a=p.parse_args()
repo=pathlib.Path(r'E:\Code\qq-agent-plus');testfile=repo/'test'/'production-embedding-cleanup.test.py';module=runpy.run_path(str(testfile),run_name='cleanup_test_module');T=module['CleanupTests']
class Result(unittest.TextTestResult):
 def __init__(self,*args,**kwargs):super().__init__(*args,**kwargs);self.subcases=[];self.methods=[]
 def addSubTest(self,test,subtest,err):self.subcases.append({'method':test._testMethodName,'parameters':dict(subtest.params),'passed':err is None});super().addSubTest(test,subtest,err)
 def addSuccess(self,test):self.methods.append(test._testMethodName);super().addSuccess(test)
records=[]
for label,source in [('frozen-archive',module['DEFAULT']),('current-operator',pathlib.Path(a.operator_source))]:
 os.environ['QQ_DEPLOY_CLEANUP_SCRIPT']=str(source)
 node=module['target_try']();buf=io.StringIO();result=unittest.TextTestRunner(stream=buf,verbosity=2,resultclass=Result).run(unittest.defaultTestLoader.loadTestsFromTestCase(T))
 faults=[x for x in result.subcases if x['method']=='test_scenarios'];reds=[x for x in result.subcases if x['method']=='test_legacy_red_baselines']
 record={'sourceLabel':label,'sourceBasename':pathlib.Path(source).name,'sourceSHA256':hashlib.sha256(pathlib.Path(source).read_bytes()).hexdigest(),'fragmentSHA256':hashlib.sha256(ast.dump(node,include_attributes=False).encode()).hexdigest(),'unittestMethodsRun':result.testsRun,'currentScenarios':len(faults)+int('test_success_no_pause' in result.methods),'faultScenarios':faults,'controlledLegacyRedCases':reds,'uniqueCandidateCounterexamplePassed':'test_unique_candidate_guard' in result.methods,'failures':len(result.failures),'errors':len(result.errors),'skipped':len(result.skipped),'exitCode':0 if result.wasSuccessful() else 1,'noProductionOrNetworkCalls':True}
 assert record['exitCode']==0,buf.getvalue();assert record['currentScenarios']==18 and len(reds)==2 and all(x['passed'] for x in result.subcases) and record['uniqueCandidateCounterexamplePassed']
 records.append(record)
os.environ.pop('QQ_DEPLOY_CLEANUP_SCRIPT',None)
assert records[0]['fragmentSHA256']==records[1]['fragmentSHA256']
report={'status':'PASS','implementationRequestedProvider':'codex-proxy','implementationRequestedModel':'gpt-6-luna','coordinatorExecutedEvidence':True,'testsFile':'test/production-embedding-cleanup.test.py','testFileSHA256':hashlib.sha256(testfile.read_bytes()).hexdigest(),'runs':records,'fragmentIdenticalAcrossSources':True,'notProductionEmbeddingOrDeploymentAcceptance':True}
out=pathlib.Path(a.report);out.parent.mkdir(parents=True,exist_ok=True);assert not out.exists();out.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'status':'PASS','runs':[{'source':r['sourceLabel'],'methods':r['unittestMethodsRun'],'currentScenarios':r['currentScenarios'],'redCounterexamples':len(r['controlledLegacyRedCases']),'uniqueness':r['uniqueCandidateCounterexamplePassed'],'exitCode':r['exitCode']} for r in records],'fragmentIdentical':True}))
