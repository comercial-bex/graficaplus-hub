# Orçamento: PDF igual ao modelo 1059 + layouts por item + ajustes de tela

## O que falta hoje (comparado ao PDF enviado)
- Bloco do cliente em grade 2 colunas (Razão Social / Nome Fantasia, CNPJ / IE, Endereço / Bairro, CEP / Cidade, Telefone / Celular, E-mail / Contato) — hoje aparece incompleto e solto.
- Tabela de itens sem coluna "Tipo Produto" e sem a linha "Metragem: L x A = área" dentro da coluna Qtd.
- Faltam "Total Produtos", "Soma área total" logo abaixo da tabela.
- Bloco LAYOUT com miniaturas numeradas na ordem dos itens (1, 2, 3...).
- Rodapé: "Responsável" + "Data de expedição prevista" na mesma linha e a frase "Esse orçamento é válido até ...", seguido do termo de aceite com "Data ___/___/____" e assinatura "Nome e CPF".
- Cabeçalho da empresa com fone e celular separados.

## Layout por item (na tela)
- No formulário "Adicionar item": área de arrastar/soltar para várias artes já antes de salvar o item (hoje só aceita uma).
- Em cada linha da tabela: miniaturas das artes, com a capa marcada; clicar troca a capa, botão para adicionar mais, excluir.
- A capa de cada item vai para o bloco LAYOUT do PDF com o número do item.
- Aceita imagem e PDF.

## Melhorias de UX/UI na tela do orçamento
- Barra de ações fixa no topo (PDF, Via de produção, Link do cliente, WhatsApp, Converter em OS), com aviso do que falta quando desabilitada.
- Campo "Tipo de produto" no item (preenchido pelo catálogo, editável).
- Área calculada ao vivo e destacada; "Soma área total" no rodapé da tabela.
- Prazos e pagamento recolhidos em um cartão compacto lateral, deixando os itens em primeiro plano.
- Antes de gerar o PDF, aviso se faltar: contato, data de entrega, forma de pagamento ou layout em algum item.
- Estado vazio da tabela com orientação ("Busque um produto acima para começar").

## Parte técnica
- `src/lib/pdf/DocumentoPDF.tsx`: grade do cliente, coluna `tipo_produto`, metragem dentro da Qtd, totais de produtos/área, LAYOUT numerado, rodapé responsável/expedição/validade, aceite. Cabeçalho fixo por página e `wrap={false}` nas linhas.
- `src/lib/pdf/generate.ts`: carregar celular, bairro, CEP, IE, nome fantasia do cliente; `tipo_produto` dos itens; capa de cada item via `orcamento_item_arquivos`.
- Migração: coluna `tipo_produto text` em `orcamento_itens` (se não existir).
- `orcamentos.$id.tsx` + `orcamento-item-artes.tsx`: upload múltiplo no formulário de novo item, miniaturas e capa na tabela, barra de ações fixa, avisos de pendência.
- `tests/pdf-documento.test.ts`: casos com tipo de produto, várias artes e cliente completo.
