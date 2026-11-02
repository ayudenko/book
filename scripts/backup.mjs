import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, existsSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
process.umask(0o077);
const source = resolve(process.env.DATABASE_PATH || './data/quiet-chapter.sqlite');
if (!existsSync(source)) throw new Error('База не найдена. Сначала запустите приложение или укажите DATABASE_PATH.');
const dir = resolve(process.env.BACKUP_DIR || './data/backups');
mkdirSync(dir,{recursive:true,mode:0o700});
const target = join(dir,`quiet-chapter-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);
const db = new DatabaseSync(source,{readOnly:true});
try {await backup(db,target);chmodSync(target,0o600);console.log(`Резервная копия: ${target}`);}
finally {db.close();}
