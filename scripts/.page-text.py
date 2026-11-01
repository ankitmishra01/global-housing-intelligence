import sys,re,html
t=sys.stdin.read()
t=re.sub(r'<script.*?</script>|<style.*?</style>','',t,flags=re.S)
i=t.find('brief-prose')
t=t[i-200:] if i>0 else t
t=re.sub(r'<[^>]+>','\n',t); t=html.unescape(t)
lines=[l.strip() for l in t.splitlines() if l.strip()]
out=[]; 
for l in lines:
  if out and not re.match(r'^[A-Z][A-Za-z ,]+$',l) and len(l)<60 and not l.endswith('.'): out[-1]+=' '+l
  else: out.append(l)
print('\n'.join(out))
