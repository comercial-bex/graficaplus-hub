# Orçamento: resumo mais compacto, miniatura real da arte e revisão das 4 etapas

## 1. Miniatura da arte não aparece (correção)
**Causa confirmada:** a foto da peça 3D foi gravada com o nome "Foto do modelo — Kit Pintura Reitegrar" (sem ".png") e sem o tipo do arquivo. O sistema decide se é imagem só pelo nome, então mostra o ícone de documento. O arquivo de verdade é um PNG.
- Passar a reconhecer a imagem também pelo caminho guardado (que termina em .png/.jpg/.webp), na tabela de itens, na janela de artes, no PDF e no link do cliente.
- Ao salvar a foto da peça 3D, gravar o tipo do arquivo e manter a extensão no nome.
- Corrigir os arquivos já gravados assim (preencher o tipo a partir do caminho).
- Miniatura na tabela um pouco maior (56px) com prévia ampliada ao passar o mouse.

## 2. Resumo lateral mais compacto
- Coluna do resumo de 340px para 280px, espaçamentos menores, sem título grande.
- "Itens" e "Total" numa linha só no topo; metragem por material recolhível ("Metragem ▸").
- Custo e margem numa linha (ex.: "Custo R$ 798 · Margem 50%") para quem pode ver.
- Resultado: a tabela de itens ganha largura e mostra todas as colunas (Valor un., Total, Ações) sem rolagem lateral.

## 3. Tabela de itens (enxugar, manter as ações)
- Manter coluna Ações (editar, duplicar, mover, apagar) como está.
- Juntar "Metragem" e "Acabamento" sob a descrição do item quando estiverem vazios (some o "—" duplo).
- Detalhe técnico 3D ("Peça 3D · PLA · 44,67 g por impressão") em uma linha só, em cinza.
- Remover o rodapé repetido "Itens / Total / Custo / Margem" abaixo da tabela, pois já está no resumo.

## 4. Revisão das etapas (evitar erros) — comparado a Zênite, Calcgraf, Mubisys e Printi
- **Cliente:** alerta se o cliente não tem telefone/CNPJ (aparecem no PDF); botão "Usar contato avulso" visível.
- **Itens:** aviso por item quando: sem arte, margem abaixo do mínimo, preço zero ou estoque insuficiente.
- **Condições:** data de entrega obrigatória já sinalizada; sugerir prazo a partir do tempo de produção dos itens; forma de pagamento e validade com valor padrão.
- **Revisão:** lista de verificação final (cliente, itens com arte, prazo, pagamento, validade) com links para corrigir; botão de enviar só libera quando tudo está ok, ou pede confirmação.

## Alternativas para o resumo
- A. Compacto lateral (proposta acima).
- B. Resumo como barra fixa embaixo da tela (Total · Margem · Avançar), liberando a largura toda para os itens.
- C. Resumo recolhível, aberto só nas etapas Condições e Revisão.

## Detalhes técnicos
- `ehImagemVisivel`/`ehPdf` em `src/domain/os/arquivos-da-os.ts`: chamadas em `layouts-do-item.tsx` (capas, grade) passam também `caminho`; teste novo em `tests/` para nome sem extensão + caminho .png.
- `enviarLayout`: garantir `mime_type` e extensão no `nome` (foto 3D).
- Migração de dados: `update arquivos set mime_type = 'image/png'|'image/jpeg'|'image/webp' where mime_type is null and caminho ~* '\.(png|jpe?g|webp)$'`.
- `orcamentos.$id.tsx`: grade `lg:grid-cols-[minmax(0,1fr)_280px]`, resumo reorganizado, rodapé da tabela removido, alertas de linha.
- Verificar com Playwright em 1109×693 no orçamento #142.
