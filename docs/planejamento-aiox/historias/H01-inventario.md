# H01 — classificar pendências

**Necessidade:** AIOX-01 e os cinco demais temas do inventário. Como dono, quero distinguir pendências atuais de relatos históricos para não refazer trabalho concluído.

Responsável: PM, a designar. Revisor: PO, a designar. Status: documentação preparada; validação operacional pelo dono pendente.

Pré-requisitos: roadmap, diagnósticos e testes locais. Limite: não acessar produção nem afirmar falhas sem evidência.

## Critérios de aceite
1. Dado o conjunto de seis temas, quando consolidado o inventário, então cada tema apresenta fonte, situação, evidência, impacto, dependência, responsável proposto e próximo passo.
2. Dada uma lacuna histórica, quando não houver confirmação atual, então sua situação permanece “a validar”, não “falha confirmada”.
3. Dada a decisão de IA desligada, quando priorizado o trabalho, então não se cria história para ativá-la.

Verificação: leitura de `inventario.md` e rastreabilidade em `aceite.md`. Evidência: 96 testes locais aprovados, sem extrapolar seu alcance.

Reversão: retirar o inventário; nenhum dado operacional é modificado. Confirmação financeira e homologação de 3D/permissões continuam dependentes de responsáveis.