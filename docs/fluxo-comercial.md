# Fluxo Comercial Parte 1

WhatsApp/entrada → lead → cliente → orçamento → versão enviada → aprovação → conversão integral em OS → parcelas previstas → timeline/auditoria.

As operações críticas devem chamar RPCs: `converter_lead_em_cliente`, `aprovar_orcamento`, `converter_orcamento_em_os`, `avancar_os_status`, `forcar_transicao_os`, `confirmar_pagamento`, `estornar_pagamento`.
