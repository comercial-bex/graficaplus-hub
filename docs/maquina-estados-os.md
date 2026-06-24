# Máquina de Estados da OS

Eixos: `status_comercial`, `status_financeiro`, `status_arte`, `status_producao`, `status_logistica`, `status_geral`.

Transições gerais padrão: entrada → design → producao → acabamento → pronto → entregue → finalizado. Exceções exigem `os.status.override`, motivo obrigatório e evento de negócio.
