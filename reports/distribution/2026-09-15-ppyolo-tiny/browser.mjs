import fs from 'node:fs';
const p='models/ppyolo-tiny-320/0.1.0/manifest.json';
if(!fs.existsSync(p)) throw new Error('最终 manifest 尚未生成');
const m=JSON.parse(fs.readFileSync(p,'utf8')); if(m.defaultVariant!=='fp32'||m.variants.length!==1) throw new Error('清单变体错误');
fs.writeFileSync('reports/distribution/2026-09-15-ppyolo-tiny/browser.json',JSON.stringify({status:'pending',manifest:p,combinations:8},null,2)+'\n'); console.log('浏览器验证脚本已生成待执行记录');
