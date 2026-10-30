# Máquina de Estados da OS

Eixos (o eixo `status_arte` foi removido em 30/10/2026: ninguém o lia; a arte aprovada vem de `arte_aprovada_da_os`): `status_comercial`, `status_financeiro`, `status_producao`, `status_logistica`, `status_geral`.

Transições gerais padrão: entrada → design → producao → acabamento → pronto → entregue → finalizado. Exceções exigem `os.status.override`, motivo obrigatório e evento de negócio.
