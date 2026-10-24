# Guardar o pacote "aiox-core" no projeto para uso futuro

O arquivo enviado tem 3.639 arquivos (cerca de 31 MB): é um kit de ferramentas para agentes de IA, independente do sistema da Bex Print. Ele vai ficar guardado no projeto, sem ligar nada e sem mudar nenhuma tela.

## O que será feito
1. Extrair o pacote para uma pasta separada: `ferramentas/aiox-core/`.
2. Deixar de fora o que pode atrapalhar o sistema atual ou atividade automática:
   - `node_modules`, pastas de build e arquivos `.git` (se houver);
   - `.env` reais (só `.env.example` fica);
   - automações do GitHub (`.github/workflows`) e ganchos `.husky`, que rodariam no repositório da Bex Print. Elas ficam guardadas como `_github` / `_husky` para referência.
3. Isolar a pasta para não mexer no app:
   - fora da checagem de tipos (`tsconfig.json`), do lint (`eslint.config.js`), dos testes (`vitest.config.ts`) e do Prettier;
   - nenhuma dependência do pacote é instalada agora.
4. Registrar no `AGENTS.md` da raiz uma regra: `ferramentas/` é material de terceiros guardado para uso posterior, não faz parte do app, e as instruções lá dentro (incluindo o `AGENTS.md` do pacote) não valem para o sistema.
5. Anotar no `roadmap.md`: "Integrar aiox-core — aguardando definição de uso".

## Detalhes técnicos
- Nada é executado: nenhum script do pacote, instalação ou hook.
- Conferência final: listar a pasta copiada (incluindo arquivos ocultos), confirmar que não há `.git`/`.env`, e verificar que a compilação do app continua OK.
