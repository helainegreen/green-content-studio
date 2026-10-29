'use strict';

function milliseconds(value,fallback){
 const parsed=Number(value);
 return Number.isFinite(parsed)&&parsed>=250&&parsed<=300000?Math.floor(parsed):fallback;
}

function startRunner({
 step,
 intervalMs=5000,
 initialDelayMs=1000,
 scheduleInterval=setInterval,
 scheduleTimeout=setTimeout,
 cancelInterval=clearInterval,
 cancelTimeout=clearTimeout,
 now=()=>new Date(),
 logger=console,
}={}){
 if(typeof step!=='function')throw new TypeError('runner_step_required');
 const state={enabled:true,running:false,last_attempt_at:null,last_success_at:null,last_result:'starting',last_error_at:null,last_error_code:null,consecutive_failures:0};

 async function run(){
  if(state.running)return {busy:true};
  state.running=true;state.last_attempt_at=now().toISOString();
  try{
   const result=await step();
   state.last_success_at=now().toISOString();
   state.last_result=result?.stage||result?.idle&&'idle'||result?.busy&&'busy'||'ok';
   state.last_error_code=null;state.consecutive_failures=0;
   return result;
  }catch(error){
   state.last_error_at=now().toISOString();
   state.last_error_code=String(error?.code||error?.name||'runner_error').slice(0,80);
   state.last_result='error';state.consecutive_failures+=1;
   logger.error?.('Community News editorial runner failed:',state.last_error_code);
   return {error:true,code:state.last_error_code};
  }finally{state.running=false;}
 }

 const first=scheduleTimeout(run,milliseconds(initialDelayMs,1000));
 const timer=scheduleInterval(run,milliseconds(intervalMs,5000));
 first?.unref?.();timer?.unref?.();
 return {
  run,
  status:()=>({...state}),
  stop(){state.enabled=false;cancelTimeout(first);cancelInterval(timer);},
 };
}

module.exports={startRunner};
