# Aviso privado ao gerente

Migração: `supabase/migrations/20261115200000_aviso_privado_do_gerente.sql`. Estado: **não aplicada no banco vivo.**

## O que é

Um evento e um modelo novos, `aviso_gerente_privado` (corpo `{{texto}}`), separados do `aviso_grupo_equipe`. Quem enfileira usa este evento com o celular do gestor como destino. Nada enfileira sozinho: esta entrega só abre o caminho.

## Regras

- A trava do grupo (`EVENTOS_SO_PARA_GRUPO`) não mudou. O evento novo não está nela.
- Nova trava no despachante (`src/lib/api/whatsapp-enviar.server.ts`, antes do envio): o destino precisa ser o celular de usuário ativo com papel gestor ou admin, lido de `whatsapp_cobranca_equipe()` (traz telefone e papéis). Cliente, parceiro, vendedor, grupo ou número vazio viram falha definitiva sem chamar o Z-API. Se a leitura da gerência falhar, a linha volta à fila sem gastar tentativa.
- Evento e modelo da linha precisam ser os dois `aviso_gerente_privado`.
- Formato: a fila grava sem o 55 (`normalize_whatsapp_phone`, ex. 96984079775); o envio converte para 5596984079775, que é o que o Z-API aceita.
- O aviso não vira conversa na caixa de entrada.
- A função de borda `process-automations` recusa este evento: só o despachante do app envia.
- O modelo nasce ativo apenas se o do grupo estiver ativo.

## Ensaio de banco (15/11/2026, só SELECT, nada gravado)

- Gestor: Raymison Saraiva, ativo, papéis gestor e vendedor, telefone 96984079775, aparece em `whatsapp_cobranca_equipe()`.
- `normalize_whatsapp_phone('5596984079775')` e do número sem 55 dão 96984079775.
- Antes da migração não existe modelo `aviso_gerente_privado`; `aviso_grupo_equipe` está ativo.

Ensaio da migração, para rodar antes de aplicar (termina em RAISE EXCEPTION e desfaz tudo): executar o INSERT do arquivo e conferir `SELECT evento, ativo, corpo FROM notificacao_templates WHERE evento = 'aviso_gerente_privado'` (esperado: uma linha, ativo true, corpo `{{texto}}`); depois `RAISE EXCEPTION 'ensaio'`.

## Testes

`TZ=UTC npx vitest run tests/aviso-privado-do-gerente.test.ts tests/aviso-no-grupo-da-equipe.test.ts`
