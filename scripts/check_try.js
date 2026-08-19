import fs from 'fs';
const s = fs.readFileSync('controllers/webhookController.js','utf8');
function isWordAt(s,i,word){return s.substr(i,word.length)===word && (i+word.length===s.length||/\W/.test(s[i+word.length]));}
let i=0; const n=s.length; let issues=[];
while(i<n){
  if(isWordAt(s,i,'try')){
    let j=i+3; while(j<n && /\s/.test(s[j])) j++;
    if(s[j]==='{'){
      let depth=0; let k=j;
      for(;k<n;k++){
        const ch=s[k];
        if(ch==='{') depth++;
        else if(ch==='}') { depth--; if(depth===0) break; }
        if(ch==="\""||ch==="'"||ch==='`'){
          const quote=ch; k++; while(k<n){ if(s[k]==='\\') { k+=2; continue;} if(s[k]===quote) break; k++; }
        }
        if(s[k]==='/' && s[k+1]==='*'){ k+=2; while(k<n){ if(s[k]==='*' && s[k+1]==='/'){ k+=1; break;} k++; }}
        if(s[k]==='/' && s[k+1]==='/'){ k+=2; while(k<n && s[k]!=='\n') k++; }
      }
      if(k>=n){ issues.push({pos:i, reason:'no closing brace for try block'}); i+=3; continue; }
      let m=k+1; while(m<n && /[\s;\n\r]/.test(s[m])) m++;
      if(!isWordAt(s,m,'catch') && !isWordAt(s,m,'finally')){
        issues.push({pos:i, line:(s.substr(0,i).match(/\n/g)||[]).length+1, afterSnippet:s.substr(i, Math.min(200,n-i))});
      }
      i=k+1; continue;
    }
  }
  i++;
}
if(issues.length===0) console.log('No try-without-catch issues found'); else console.log('Issues:',JSON.stringify(issues,null,2));
