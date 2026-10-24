# Inventário PM/PO — Bex Print

Data: 24/10/2026. Preparação documental sob o plano aprovado; não é homologação de produção.

| ID | Necessidade e fonte | Situação/evidência | Impacto e dependência | Responsável proposto / próximo passo |
|---|---|---|---|---|
| AIOX-01 | Adotar ferramentas com isolamento; plano aprovado de 24/10 e roadmap | **Confirmado**: documentação iniciada; referência de 5 arquivos em `/tmp/aiox-piloto-bex`, sem instalação | Evitar alteração do app; depende de anfitrião autenticado e operador | Operação técnica, a designar; confirmar acesso antes de instalação/piloto |
| WA-01 | Preservar a caixa WhatsApp concluída; roadmap, seção caixa v3 | **Concluído com evidência documental e testes locais parciais**: 55 testes de caixa/fila/assistente passaram nesta rodada; sem nova homologação autenticada | Atendimento; verificação real exigiria conta e destinatário autorizados | QA, a designar; não abrir reimplementação sem reprodução |
| WA-02 | Manter assistente desligado; decisão do dono registrada no roadmap de 08/10 | **Fora do escopo** desta execução: decisão mantida, não alterada; estado hospedado não foi consultado | Evitar respostas/custos não autorizados; ativação exige pedido separado | Dono; nenhuma ação de ativação |
| FIN-01 | Importar extrato real e conciliar; histórico do pedido e índice AIOX | **A validar**: não há confirmação atual de arquivo pendente; 20 testes locais de extrato passaram | Saldo real não pode ser presumido; depende de confirmação e arquivo autorizado se ainda faltar | Financeiro, a designar; confirmar necessidade antes de pedir arquivo |
| 3D-01 | Conversão 3D → OS e portal íntegros; auditoria parte 3 e documento de homologação | **A validar**: relatos históricos não comprovam falha atual; 5 testes de cálculo 3D e 16 de painel do portal passaram, mas não testam conversão transacional real | Produção/custo e acesso do cliente; depende de homologação específica | Produção + QA, a designar; localizar aceite posterior ou reproduzir em ambiente autorizado |
| SEC-01 | Permissões, concorrência e estruturas antigas; status parte 1 e matriz de permissões | **A validar**: pendências históricas; nenhuma inspeção nova de dados/RLS nesta execução | Segurança/integridade; revisão requer acesso e escopo específicos | Responsável de dados + QA, a designar; reconfirmar quais verificações ainda faltam |

## Evidência executada

Comando: `bunx vitest run tests/whatsapp-assistente.test.ts tests/whatsapp-caixa-de-entrada.test.ts tests/whatsapp-filas.test.ts tests/extrato-bancario.test.ts tests/impressao3d-cost-engine.test.ts tests/portal-painel.test.ts`.

Resultado: **6 arquivos, 96 testes aprovados**. Registro temporário: `/tmp/aiox-evidencias-testes.log`. Nenhum teste de envio real ou operação em produção foi realizado. Testes presentes/passando não encerram automaticamente lacunas de homologação.

Fontes históricas: `docs/status-implementacao-parte-1.md`, `docs/auditoria-parte3-final.md`, `docs/parte3-impressao3d-deploy-homologacao.md`. Fontes atuais: `roadmap.md`, testes acima e plano aprovado. Os documentos não atribuem pessoas nem inventam preços, saldos ou prazos.