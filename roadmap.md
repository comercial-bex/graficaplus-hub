# Roadmap

- [x] Criar temas claro e escuro com Montserrat e preferência persistente.
- [x] Manter o menu lateral escuro e sem reorganização.
- [x] Adicionar alternância de tema no cabeçalho autenticado.
- [x] Unificar cabeçalhos, indicadores, painéis, tabelas, campos, estados e tooltips.
- [x] Completar as dicas das 54 áreas exibidas no menu.
- [x] Validar compilação, tema inicial, persistência e ausência de erros no navegador.

## WhatsApp — caixa v3 (pedido 07/10)
- [x] A) Filas por setor (enum, coluna, usuarios.filas, transferir fila, chips; filas da equipe no Monitor). O submenu por setor ficou como chips na caixa e `?fila=` na URL.
- [x] B) Atendimentos imutáveis (WA-AAMM-NNNN, abrir/reabrir/resolver com motivo, painel)
- [x] C) Fila humana (/whatsapp-fila-humana, espera), leituras por usuário
- [x] D) Assistente de IA (chamada pelo webhook com teto de tempo; rota /api/whatsapp/agente para reprocessar; classificação, resposta, transferência, configurações, logs). Nasce DESLIGADA.
- [x] E) UX: chips de fila coloridos, atalhos R/T/E/Esc, estados vazios
- [x] Testes: resolver atendido recusado, reabertura, agente com responsável, flood control
- [x] Assistente usa a OpenAI (OPENAI_API_KEY, modelo OPENAI_MODEL ou gpt-5-mini), nunca o saldo do Lovable; não liga sem a chave (08/10)
- [x] "Reprocessar mensagens sem texto" consertado (a função dava 42P10 e nunca gravou); as 3 mensagens de modelo recuperadas (08/10)
- [ ] Assistente fica DESLIGADA por decisão do dono (08/10). Se um dia ligar: cadastrar OPENAI_API_KEY no Bex Print, preencher endereço e horário, auditar as primeiras decisões
- [ ] `whatsapp_responder` e `whatsapp_vincular_cliente` ainda aceitam chamada do navegador (conferem a permissão por dentro): passar para o padrão server function + REVOKE
