import {createBridge} from '../lib/bridge.mjs';
try {
  const bridge=createBridge({backendUrl:process.env.APPS_SCRIPT_URL,secret:process.env.HOSTING_SECRET});
  const result=await bridge({action:'connection'});
  if(!result.ok||!result.result.spreadsheetReady)throw new Error('Check the new Apps Script deployment, HOSTING_SECRET, and the existing Sheet connection.');
  console.log('Connected to the Family Tasks spreadsheet. No family data was changed.');
}catch(error){console.error(error.message);process.exitCode=1;}
