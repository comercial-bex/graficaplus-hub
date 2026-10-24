# H02 — preparar ambiente isolado

**Necessidade:** AIOX-01. Como operador técnico, quero separar ferramentas do app para impedir mudanças automáticas indevidas.

Responsável: operação técnica, a designar. Revisor: responsável de segurança, a designar. Status: **parcial/bloqueada antes de instalação**.

Pré-requisitos: versão fixada, anfitrião com acesso confirmado, operador e custos autorizados. Limites: sem instalação global, hooks, automações ou regras de IDE na raiz do app; sem cópia de código/dados/segredos para o anfitrião.

## Critérios de aceite
1. Dada a cópia de referência, quando preparada, então somente os cinco arquivos autorizados estão em `/tmp/aiox-piloto-bex/referencia`, em modo somente leitura, com hashes no manifesto.
2. Dada a verificação de ambiente, então Node atende ≥18, npm ≥9 e a disponibilidade e acesso do anfitrião estão comprovados separadamente.
3. Dado anfitrião sem acesso confirmado, quando se alcançar a instalação, então a execução para sem instalar dependências ou acionar APIs pagas.
4. Dada futura instalação, então revisão de scripts e comparação de alterações comprovam ausência de efeitos na raiz do Bex Print antes de aceitar a história.

Evidência atual: Node 22.23.4, npm 10.9.9, Claude Code 2.1.289 disponível; sessão não confirmada. Critérios 1 e parte do 2 verificados; 3 respeitado; 4 não executado.

Reversão: remover `/tmp/aiox-piloto-bex`; não prometer persistência desse diretório. Operador/ambiente durável ainda a definir.