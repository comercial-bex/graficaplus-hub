# H03 — executar piloto PM/PO

**Necessidade:** AIOX-01. Como dono, quero observar uma execução real que gere escopo e histórias antes de adotar a ferramenta continuamente.

Responsável: operador PM/PO, a designar. Revisor: PO e dono. Status: **bloqueada por H02**; documentos desta pasta são preparação manual, não saída de um AIOX executado.

Pré-requisitos: H02 aceito, sessão autorizada, custo/operador definidos, contexto sanitizado. Limites: sem acesso a banco, envio de mensagens, aplicação automática de código ou ativação da IA.

## Critérios de aceite
1. Dado o ambiente aceito, quando rodar o piloto, então uma execução registrada do anfitrião produz inventário, escopo e histórias em área de saída isolada.
2. Dadas as saídas, quando revisadas, então somente documentos aprovados são incorporados ao projeto e as fontes/limitações permanecem explícitas.
3. Dado o piloto, então nenhuma dependência, configuração operacional ou dado do app é alterado.
4. Dado custo de uso externo, então ele é registrado a partir de medição disponível, nunca inventado ou considerado gratuito por presunção.

Evidência esperada: registro sanitizado de execução, versão, contexto autorizado, documentos produzidos e comparação de alterações. Nenhuma dessa execução está disponível agora.

Reversão: descartar saídas isoladas e interromper anfitrião. Não executar scripts do pacote para contornar ausência de sessão.