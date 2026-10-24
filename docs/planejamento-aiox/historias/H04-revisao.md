# H04 — revisar e decidir continuidade

**Necessidade:** AIOX-01 e SEC-01 quando houver história confirmada de dados. Como dono, quero um parecer verificável antes de ampliar o uso.

Responsável: revisão de dados + QA, a designar. Decisão de negócio: dono. Status: revisão documental preparada; aceite do piloto bloqueado por H03.

Pré-requisitos: saídas e registro de H03. Limites: revisão não autoriza migração, permissões novas, mensagens ou publicação.

## Critérios de aceite
1. Dada cada história, quando revisada, então necessidade, dependências e verificações são rastreáveis e possíveis de reprovar.
2. Dada uma proposta envolvendo dados, então o parecer separa recomendação de autorização e protege regras locais e idempotência do webhook.
3. Dada ausência de piloto real, então a avaliação informa “integração não concluída”, sem emitir aprovação operacional.
4. Dadas evidências suficientes, então a decisão registra continuar, ajustar ou interromper e identifica operador, custos, manutenção e ambiente durável.

Evidência atual: `aceite.md` e `avaliacao-piloto.md`, exclusivamente documentais. Reversão: manter a decisão de interromper e descartar ambiente isolado sem impacto no app.