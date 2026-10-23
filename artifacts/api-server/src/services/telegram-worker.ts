import {pool} from "@workspace/db";
import {logger} from "../lib/logger";
import {telegramApi,getTelegramHealth,telegramRuntimeEnabled} from "./telegram-provider";
import {checkTelegramRuntimeHealth,acceptTelegramUpdate} from "./telegram-links";
import {dispatchCommunicationDeliveries} from "./communication-service";
let running=false,lastHealth=0;
export async function telegramWorkerTick(){
  if(running||!telegramRuntimeEnabled(process.env))return;
  running=true;
  try{
    if(Date.now()-lastHealth>60000){lastHealth=Date.now();
      const h=await checkTelegramRuntimeHealth(pool);
      logger.info({configured:h.configured,ready:h.ready,reason:h.reason},"Telegram delivery configuration health");
    }
    const health=getTelegramHealth();if(!health.ready)return;
    const db=await pool.connect();
    try{
      const acquired=(await db.query("SELECT pg_try_advisory_lock(31971,1) AS acquired")).rows[0]?.acquired;
      if(!acquired)return;
      try{
        await db.query("BEGIN");
        await db.query(`INSERT INTO telegram_poll_state(id,bot_id,last_update_id) VALUES(1,$1,0)
          ON CONFLICT(id) DO UPDATE SET bot_id=excluded.bot_id,
          last_update_id=CASE WHEN telegram_poll_state.bot_id=excluded.bot_id THEN telegram_poll_state.last_update_id ELSE 0 END`,
          [health.botId]);
        const state=(await db.query("SELECT last_update_id FROM telegram_poll_state WHERE id=1 FOR UPDATE")).rows[0];
        const updates=await telegramApi("getUpdates",{offset:state.last_update_id+1,limit:100,timeout:0,allowed_updates:["message"]});
        if(!Array.isArray(updates))throw new Error("Invalid Telegram updates");
        let last=state.last_update_id;
        for(const update of updates){
          if(!Number.isSafeInteger(update.update_id)||update.update_id<=last||update.update_id>2147483647)continue;
          await acceptTelegramUpdate(db,update);last=update.update_id;
        }
        await db.query("UPDATE telegram_poll_state SET last_update_id=$1 WHERE id=1",[last]);
        await db.query(`UPDATE telegram_link_challenges SET pending_ciphertext=NULL,chat_hash=NULL
          WHERE expires_at<=now() AND pending_ciphertext IS NOT NULL`);
        await db.query("COMMIT");
      }catch{await db.query("ROLLBACK");logger.warn({category:"TELEGRAM_POLL_UNAVAILABLE"},"Telegram linking temporarily unavailable");}
      finally{await db.query("SELECT pg_advisory_unlock(31971,1)");}
    }finally{db.release();}
    // This opt-in worker cannot claim SMS/email/push or revive paused Development workers.
    await dispatchCommunicationDeliveries(pool,10,{allowConfiguredProviders:true,channels:["TELEGRAM"]});
  }catch{logger.warn({category:"TELEGRAM_WORKER_UNAVAILABLE"},"Telegram temporarily unavailable");}
  finally{running=false;}
}
export function startTelegramWorker(){
  if(!telegramRuntimeEnabled(process.env))return;
  void telegramWorkerTick();setInterval(()=>void telegramWorkerTick(),3000).unref();
}
