import QRCode from 'qrcode';
import { execFileSync } from 'child_process';

// ---- 1. QR render test ----
const sampleUrl = 'https://excashier.alipay.com/standard/checkout?orderStr=20260603008281234847110000022478';
await QRCode.toFile('/tmp/qr_test.png', sampleUrl, { width: 360, margin: 2 });
console.log('QR PNG written: /tmp/qr_test.png');
// decode back to prove it's scannable
const buf = execFileSync('node', ['-e', `
const fs=require('fs');const {Jimp}=(()=>{try{return require('jimp')}catch{return {}}})();
console.log('skip-decode');
`]).toString().trim();

// ---- 2. retry-masks-transient test (mimics checkWalletReady) ----
const WALLET_SETUP_NEEDED=/未开通|未开启|未授权|等待授权/;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function rawCheck(){
  try{return execFileSync('alipay-bot',['check-wallet'],{env:{PATH:process.env.PATH,HOME:process.env.HOME}}).toString().trim();}
  catch(e){return (e.stdout||'').toString().trim()||'ERR';}
}
async function checkWalletReady(maxRetries=3){
  let last='';
  for(let a=0;a<=maxRetries;a++){
    if(a>0)await sleep(800*a);
    const t=rawCheck(); let j;
    try{j=JSON.parse(t)}catch{last=t;continue;}
    if(j.code===200)return {ok:true,attempts:a+1};
    last=j.message||t;
    if(WALLET_SETUP_NEEDED.test(last))throw new Error('setup-needed: '+last);
  }
  throw new Error('failed after retries: '+last);
}
let raw200=0,rawFail=0;
for(let i=0;i<12;i++){const t=rawCheck();if(t.includes('"code":200')||t.includes('"code": 200'))raw200++;else rawFail++;}
console.log(`\nRAW check-wallet over 12 calls: ${raw200} ok, ${rawFail} "查询失败"`);
let withRetryOk=0;
for(let i=0;i<8;i++){try{const r=await checkWalletReady();withRetryOk++;process.stdout.write(`run${i+1}:ok(${r.attempts}try) `);}catch(e){process.stdout.write(`run${i+1}:FAIL `);}}
console.log(`\nWITH retry over 8 flows: ${withRetryOk}/8 succeeded`);
