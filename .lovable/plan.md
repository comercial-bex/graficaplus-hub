# Impressora e filamento em seleção compacta

Na calculadora 3D (dentro do orçamento), trocar as grades de cartões de **Impressora** e **Filamento** por campos de seleção, liberando espaço. Peso do modelo e Tempo total ficam como estão.

## Impressora
- Campo de seleção único (lista suspensa).
- Cada opção mostra um ícone de impressora à esquerda, o nome e, para quem pode ver custos, "R$/h · W".
- Sem foto: as impressoras não têm foto cadastrada hoje, então usamos o ícone. Foto pode vir depois, se quiserem cadastrar.

## Filamento
- Campo de seleção com busca (são mais de 40 filamentos), mostrando nome, tipo e R$/kg.
- Ao lado do campo, uma **paleta de cores**: bolinhas coloridas com as cores existentes nos filamentos cadastrados (branco, preto, verde, ciano, lilás, dourado...).
  - Clicar numa cor filtra a lista para os filamentos daquela cor; clicar de novo limpa o filtro.
  - Cada opção da lista também mostra uma bolinha com a cor do filamento.
- A cor vem do texto já cadastrado (ex.: "Verde fosco", "Amarelo translúcido"), traduzido para uma cor de amostra; cores não reconhecidas aparecem como bolinha neutra. Tricolor/seda aparece com gradiente.

## Fora do escopo
- Peso, tempo, cálculo e banco de dados: nada muda.

## Detalhes técnicos
- Arquivo: `src/components/impressao3d/calculadora-3d.tsx` (linhas ~809–866), substituindo `GradeDeCartoes`/`CartaoDeEscolha` por `Select` (impressora) e `Popover + Command` (filamento) do shadcn.
- Novo utilitário `src/lib/cor-filamento.ts`: mapeia nome de cor PT-BR → amostra (palavra-chave), com teste unitário.
- Mantém `set("maquina_id")` / `set("material_id")` e os mesmos rótulos acessíveis.
