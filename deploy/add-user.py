#!/usr/bin/env python3
"""Individual Caddy login. Password is read from the terminal, never argv/logs."""
import getpass, os, pathlib, re, subprocess, sys
if os.geteuid() != 0: sys.exit('Execute com sudo na VM.')
if len(sys.argv) != 2 or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',sys.argv[1]): sys.exit('Uso: sudo deploy/add-user.py nome_login')
user=sys.argv[1]; password=getpass.getpass('Senha individual (mínimo 12 caracteres): ')
if len(password)<12 or len(password)>128: sys.exit('Senha deve ter 12–128 caracteres.')
if password!=getpass.getpass('Repita a senha: '): sys.exit('Senhas diferentes.')
result=subprocess.run(['caddy','hash-password'],input=password+'\n',text=True,capture_output=True,check=True)
digest=result.stdout.strip()
if not re.fullmatch(r'\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}',digest): sys.exit('Hash Caddy inesperado.')
p=pathlib.Path('/etc/verdant/caddy-users'); old=p.read_text() if p.exists() else ''
if re.search(r'^'+re.escape(user)+r'\s',old,re.M): sys.exit('Usuário já existe. Edite/remova explicitamente a entrada antes de redefinir senha.')
tmp=p.with_suffix('.next'); tmp.write_text(old.rstrip()+'\n'+user+' '+digest+'\n'); os.chmod(tmp,0o640)
subprocess.run(['chown','root:caddy',str(tmp)],check=True); tmp.replace(p)
print('Usuário adicionado. Execute configure.sh ou valide/recarregue Caddy para aplicar.')
