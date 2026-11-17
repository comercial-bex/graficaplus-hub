# Ensaio da migração: orçamento só é apagado se for rascunho sem rastro

Migração: `supabase/migrations/20261117120000_orcamento_so_apaga_rascunho_sem_rastro.sql`. Estado: **ensaiada no banco vivo em 17/11/2026, desfeita por RAISE EXCEPTION final. NÃO aplicada: quem aplica é o dono, depois de revisar.** Teste: `tests/orcamento-so-apaga-rascunho-sem-rastro-migracao.test.ts`.

Conferido depois do ensaio, no banco vivo: 127 orçamentos, nenhum gatilho `tg_orcamento_so_apaga_rascunho_sem_rastro`, nenhuma função de mesmo nome.

## O que a migração faz

Cria o gatilho `BEFORE DELETE ... FOR EACH ROW` e a função `tg_orcamento_so_apaga_rascunho_sem_rastro()` (SECURITY DEFINER, `search_path = public`, fechada para PUBLIC, anon e authenticated). Só deixa apagar orçamento em `rascunho` sem rastro: envio, versão, documento enviado, link aberto, aprovação, OS, comprovante, cobrança, pedido de parceiro, cobrança no WhatsApp, solicitação do portal, peça 3D, arquivo de impressão ou PDF gerado. Vale para todos, inclusive service_role e migração. Quem pode apagar continua sendo só admin e gestor (policy `orc admin delete`). Erro `23001` com texto neutro: "Este orçamento não pode ser apagado: motivo. Fale com o gestor." NÃO mexe em TRUNCATE nem em DELETE de anon (fora desta onda).

Md5 do corpo impresso pelo banco no ensaio: `2cab53763268a9fa8a82ae15b4113f04`. ACL da função: só `postgres` e `service_role` (nenhum GRANT novo).

## Ensaio no banco vivo (duas rodadas, cada uma termina em RAISE EXCEPTION)

Rodada 1: como dono do banco, tenta apagar os 127 orçamentos, um por vez, cada tentativa em sub-bloco, e termina em RAISE EXCEPTION 'ENSAIO PARCIAL' (o relatório sai no erro e tudo é desfeito). Resultado literal:

```
ENSAIO PARCIAL (para ver o loop acima):
[0] antes: orcamentos=127 md5 da funcao=2cab53763268a9fa8a82ae15b4113f04 proacl={postgres=X/postgres,service_role=X/postgres}
    contas: admin=true gestor=true financeiro=true vendedor=true
[1] como dono do banco: apagaria 24 e bloquearia 103. Apagaria os numeros: {165,166,169,170,172,173,181,182,183,185,186,188,189,190,194,199,207,214,219,225,230,232,252,253}
    restantes depois do loop (dentro do ensaio): 103 em aprovado,convertido,enviado,expirado,rascunho,rejeitado
[2] DELETE 142: 23001 Este orçamento não pode ser apagado: ele já passou da fase de rascunho. Fale com o gestor.
[2] DELETE 132: 23001 Este orçamento não pode ser apagado: o cliente já abriu o link. Fale com o gestor.
[2] DELETE 69: 23001 Este orçamento não pode ser apagado: ele já gerou PDF. Fale com o gestor.
[2] DELETE 251: 23001 Este orçamento não pode ser apagado: ele está ligado a pedido de parceiro, cobrança no WhatsApp, peça 3D ou arquivo de impressão. Fale com o gestor.
[2] DELETE 227: 23001 Este orçamento não pode ser apagado: ele já passou da fase de rascunho. Fale com o gestor.
[3] admin apaga o aprovado 142: 23001 Este orçamento não pode ser apagado: ele já passou da fase de rascunho. Fale com o gestor.
    admin apaga o rascunho 181 (ja apagado no loop acima? true): linhas=0
```

Os 24 que o gatilho deixaria apagar são rascunhos sem nenhum rastro (23 vazios ou sem vínculo mais o 181). Nenhum aprovado, convertido, enviado, expirado, recusado, com OS, comprovante, versão, PDF ou peça 3D entra na lista. Atenção: o 185 (arvore natalina, item KIT CHURRASCO LONGO a zero) é um rascunho sem rastro e **fica apagável** por admin e gestor; o mapa pedia decidir o destino dele antes (cancelar com motivo, nunca apagar). Cancelar está fora desta onda.

Rodada 2: por perfil, com a função recriada na mesma transação. Resultado literal:

```
ENSAIO OK, DESFEITO:
[1] admin: aprovado 142 -> 23001; rascunho livre 181 -> linhas apagadas=1
[2] gestor: enviado 227 -> 23001; rascunho livre 182 -> linhas apagadas=1
[3] vendedor: rascunho livre 183 -> linhas apagadas=0
    financeiro: rascunho livre 183 -> linhas apagadas=0
    conta sem papel: rascunho livre 183 -> linhas apagadas=0
    anon: linhas apagadas=0
[4] service_role: aprovado com OS 152 -> 23001; rascunho livre 183 -> linhas apagadas=1
[5] itens do rascunho apagado 181 que sobraram: 0
    logs_auditoria novos dentro do ensaio: 3
```

Leitura: só admin e gestor chegam a apagar (a policy segura os outros com 0 linhas); o gatilho segura o que tem rastro até para a chave de serviço; a cascata do rascunho livre não deixa item órfão e a auditoria de exclusão continua gravando.

Ensaiado também na sequência completa 1 a 6 (docs/ensaio-orcamentos-onda-1.sql): service_role apagando o 197 (aprovado pelo cliente dentro do ensaio) recebe `23001`; o gestor apaga o rascunho livre 253 (1 linha) e é barrado no 233.

## O que a tela precisa

`mensagemErro` tratando `23001` (o texto já vem pronto do banco). O botão de apagar rascunho só deve aparecer para admin e gestor.
