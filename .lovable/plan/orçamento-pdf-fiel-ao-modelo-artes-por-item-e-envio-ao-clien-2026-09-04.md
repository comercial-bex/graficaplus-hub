# Orçamento: PDF fiel ao modelo, artes por item e envio ao cliente

Objetivo: o orçamento impresso ficar visualmente igual ao modelo enviado (com acabamento melhor), permitir várias artes por produto, e sair do sistema direto para o cliente — por WhatsApp, por link de aprovação e em via de produção sem valores.

## 1. PDF igual ao modelo

Mesma ordem e mesmos blocos do arquivo enviado, com tipografia e espaçamento mais limpos:

```text
[logo]  Empresa, endereço, CNPJ/IE, fones, e-mail        Orçamento Nº 1059
Data de Emissão                                          Data de Entrega
┌ Razão Social / Nome Fantasia / CNPJ / IE / End / Bairro / CEP / Cidade
│ Telefone / Celular / E-mail / Contato
┌ PRODUTOS/SERVIÇOS
│ #  Dados do produto   Tipo   Acabamento   Qtd + Metragem   Valor   Valor Total
│ Total Produtos  ·  Soma área total
┌ LAYOUT   (miniaturas numeradas, na mesma ordem dos itens)
┌ ENDEREÇO: ENTREGA
                                   Valor Desconto  ·  Valor Total do Orçamento
┌ PAGAMENTO   forma, condições, parcelas
┌ OBSERVAÇÃO
Responsável                                    Data de expedição prevista
Validade do orçamento
        Termo de aceite + linha de assinatura (Nome e CPF)
```

Detalhes que hoje faltam e entram: nome fantasia, CNPJ/IE do cliente, celular separado do telefone, bairro/CEP, coluna "Tipo produto", linha "Metragem: L x A = área" dentro da coluna de quantidade, "Total Produtos", "Soma área total", "Data de expedição prevista" e a frase de validade. Cabeçalho e rodapé se repetem a cada página; o bloco de itens não quebra no meio de uma linha.

Melhorias de acabamento sobre o modelo: números dos itens ligados às miniaturas do LAYOUT, alinhamento monoespaçado dos valores, blocos com respiro maior e cores/logo da Bex Print.

## 2. Várias artes por produto (1 vai para o PDF)

Hoje cada item aceita um arquivo. Passa a aceitar vários, com uma marcada como capa:

- Arrastar/soltar vários arquivos no item, com miniaturas, renomear, reordenar e excluir.
- A primeira arte vira capa automaticamente; dá para trocar clicando na miniatura.
- A capa é a que aparece no bloco LAYOUT do PDF; as demais ficam listadas no orçamento e visíveis no link do cliente e na OS gerada.
- Aceita imagem e PDF; para PDF gera miniatura da primeira página.

## 3. Enviar ao cliente

- **WhatsApp**: botão gera o PDF, salva no histórico e abre a conversa com mensagem pronta (nº do orçamento, valor, validade, link).
- **Link público de aprovação**: página com o orçamento, as artes e botões Aprovar / Solicitar ajuste, registrando quem aprovou, quando e de qual IP; aprovação muda o status e libera a conversão em OS.
- **Via de produção**: mesmo PDF sem valores, com destaque para metragem, acabamento e artes.

## 4. UX da tela de orçamento

- Barra de ações fixa no topo: Pré-visualizar, Baixar, Enviar WhatsApp, Link do cliente, Via de produção, Converter em OS — com estados desabilitados explicando o que falta (ex.: "vincule um cliente para converter").
- Painel de itens em cartões: descrição, tipo, medidas com área calculada ao vivo, acabamento, artes e total do item.
- Resumo lateral fixo: soma de área, subtotal, desconto, total, prazo e validade.
- Aviso quando faltar dado obrigatório do PDF (contato, prazo de entrega, forma de pagamento) antes de enviar ao cliente.

## Parte técnica

- `src/lib/pdf/DocumentoPDF.tsx`: reescrita do layout em blocos com moldura; `DocItem` ganha `tipo_produto`, `layouts: string[]`; cabeçalho fixo com `render`/`fixed`, `wrap={false}` por linha.
- `src/lib/pdf/generate.ts`: carregar cliente com nome fantasia/CNPJ/IE/endereço, empresa, prazos (`data_inicio`, `data_entrega_prometida`) e assinar as URLs de todas as artes.
- Migração: tabela `orcamento_item_arquivos` (item_id, arquivo_id, capa boolean, ordem) com GRANT + RLS; coluna `aprovado_em`/`aprovado_por_nome`/`aprovado_ip` em `orcamentos`.
- Link público: rota já existente `publico.$token` estendida com aprovação, usando `arquivo_tokens_externos` como base do token.
- WhatsApp: reaproveita `whatsapp.functions.ts` e a fila de envio existente.
- Testes: `tests/pdf-documento.test.ts` ganha casos de múltiplas artes, cliente sem CNPJ e via de produção.
