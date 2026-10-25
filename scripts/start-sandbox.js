import fs from 'node:fs';
const settings=JSON.parse(fs.readFileSync(new URL('../.sandbox/environment.json',import.meta.url),'utf8'));
Object.assign(process.env,{SANDBOX_MODE:'true',DATABASE_URL:settings.databaseUrl,SANDBOX_ID:settings.sandboxId,SANDBOX_ACCESS_CODE:settings.accessCode,JWT_SECRET:settings.jwtSecret,NODE_ENV:'development',PORT:'5191',CORS_ORIGINS:'http://localhost:5191'});
const {default:app}=await import('../src/sandbox-app.js');
app.listen(5191,'127.0.0.1',()=>console.log('Isolated test copy: http://localhost:5191/_sandbox'));
