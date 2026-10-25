// Only the independent test database contains this metadata schema.
export const quote=name=>'"'+String(name).replaceAll('"','""')+'"';
export async function describeTables(c){
 const tables=(await c.query(`SELECT c.relname AS name,array_agg(a.attname::text ORDER BY a.attnum) AS columns FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped WHERE n.nspname='club' AND c.relkind='r' GROUP BY c.relname ORDER BY c.relname`)).rows;
 const dependencies=(await c.query(`SELECT child.relname AS child,parent.relname AS parent FROM pg_constraint f JOIN pg_class child ON child.oid=f.conrelid JOIN pg_class parent ON parent.oid=f.confrelid JOIN pg_namespace n ON n.oid=child.relnamespace WHERE f.contype='f' AND n.nspname='club' AND f.conrelid<>f.confrelid`)).rows;
 const ordered=[];
 while(ordered.length<tables.length){const next=tables.find(t=>!ordered.includes(t)&&dependencies.filter(d=>d.child===t.name).every(d=>ordered.some(p=>p.name===d.parent)||!tables.some(p=>p.name===d.parent)));if(!next)throw Error('Unsupported cyclic table dependencies');ordered.push(next)}
 return ordered;
}
export async function captureSnapshot(c){
 const tables=await describeTables(c);
 for(const table of tables)table.rows=(await c.query('SELECT * FROM club.'+quote(table.name))).rows;
 const sequences=(await c.query(`SELECT sequencename FROM pg_sequences WHERE schemaname='club' ORDER BY sequencename`)).rows;
 for(const sequence of sequences)Object.assign(sequence,(await c.query('SELECT last_value::text,is_called FROM club.'+quote(sequence.sequencename))).rows[0]);
 return {at:new Date().toISOString(),tables,sequences};
}
export async function restoreSnapshot(c,snapshot){
 const known=await describeTables(c);
 if(snapshot.tables.length!==known.length||snapshot.tables.some(t=>!known.some(k=>k.name===t.name&&JSON.stringify(k.columns)===JSON.stringify(t.columns))))throw Error('Snapshot schema does not match this test database');
 await c.query('TRUNCATE '+known.map(t=>'club.'+quote(t.name)).join(',')+' RESTART IDENTITY');
 for(const table of snapshot.tables){
  if(!table.rows.length)continue;
  const columns=table.columns.map(quote).join(',');
  await c.query(`INSERT INTO club.${quote(table.name)} (${columns}) OVERRIDING SYSTEM VALUE SELECT ${columns} FROM jsonb_populate_recordset(NULL::club.${quote(table.name)},$1::jsonb)`,[JSON.stringify(table.rows)]);
 }
 for(const sequence of snapshot.sequences)await c.query('SELECT setval($1::regclass,$2::bigint,$3)',['club.'+quote(sequence.sequencename),sequence.last_value,sequence.is_called]);
}
