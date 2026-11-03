# Resposta: modelos de imagem do gateway (consultado hoje, 03/11/2026)

Nenhum arquivo do app foi alterado. A lista abaixo veio da consulta à lista de modelos do gateway com a chave do projeto.

## 1. Ids exatos que o gateway aceita hoje

| Id | Endpoints suportados | Custo da imagem gerada (créditos por token de imagem) |
|---|---|---|
| `google/gemini-2.5-flash-image` | chat-completions, image-generation | 0.00012 |
| `google/gemini-3.1-flash-image` | chat-completions, image-generation | 0.00024 |
| `google/gemini-3.1-flash-lite-image` | **só** image-generation | 0.00012 |
| `google/gemini-3-pro-image` | chat-completions, image-generation | 0.00048 |
| `openai/gpt-image-1-mini` | image-generation, image-edit | 0.000032 |
| `openai/gpt-image-2` | image-generation, image-edit | 0.00012 |
| `openai/gpt-image-2.5-flare` | image-generation, image-edit | 0.00012 |
| `openai/gpt-image-2.5-sunburst` | image-generation, image-edit | 0.00012 |

- `google/gemini-2.5-flash-image-preview` e `google/gemini-3-pro-image-preview` **não aparecem mais**. O id atual do Pro é `google/gemini-3-pro-image`, sem "-preview".
- Mais barato: `openai/gpt-image-1-mini` cobra o menor preço por token. Entre os nomes que você citou, o mais rápido é `openai/gpt-image-2.5-flare`, feito para rascunhos rápidos. Entre os Gemini, o mais barato é `google/gemini-3.1-flash-lite-image`.
- Para uma foto de catálogo quadrada em fundo branco, a melhor relação entre custo e velocidade é `openai/gpt-image-2.5-flare`. Se o menor custo importar mais que a qualidade, use `openai/gpt-image-1-mini`.
- Isto não foi confirmado: o custo final também depende de quantos tokens cada imagem gasta, e não gerei imagens para medir.

## 2. Endpoint

- **chat/completions com `modalities: ["image","text"]`:** só os Gemini que listam "chat-completions", ou seja, 2.5-flash-image, 3.1-flash-image e 3-pro-image.
- **Endpoint de geração de imagem (image-generation):** todos os modelos acima. É o único endpoint possível para os modelos GPT Image e para o Gemini 3.1 Flash Lite Image. Ele segue o formato OpenAI `/v1/images/generations`. Para editar uma foto, use `/v1/images/edits`.
- O caminho e os campos exatos do endpoint de geração de imagem não foram confirmados por uma chamada real. Conferi apenas a lista de modelos.

## 3. Onde vem a imagem e tamanho quadrado

- **chat/completions (Gemini):** `choices[0].message.images[0].image_url.url`, como data URL `data:image/png;base64,...`. Esse formato já funciona no seu arquivo.
- **images/generations:** `data[0].b64_json`, em base64 puro sem o prefixo `data:`. Para usar, monte `data:image/png;base64,${b64}`.
- **Tamanho quadrado:** nos modelos GPT Image, envie `size: "1024x1024"`. Os modelos Gemini não aceitam esse campo de forma garantida. Peça "imagem quadrada 1:1" no texto do pedido.

## 4. Exemplos de chamada `fetch` no servidor

```ts
// A) chat/completions — só Gemini
const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "google/gemini-2.5-flash-image",
    modalities: ["image", "text"],
    messages: [{ role: "user", content: "Foto de catálogo quadrada 1:1 de um banner em lona, fundo branco puro, luz de estúdio." }],
  }),
});
const j = await r.json();
const dataUrl = j.choices?.[0]?.message?.images?.[0]?.image_url?.url;
```

```ts
// B) images/generations — GPT Image e Gemini 3.1 Flash Lite Image
const r = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "openai/gpt-image-2.5-flare",
    prompt: "Foto de catálogo de um banner em lona, fundo branco puro, luz de estúdio.",
    size: "1024x1024",
    n: 1,
  }),
});
const j = await r.json();
const dataUrl = `data:image/png;base64,${j.data?.[0]?.b64_json}`;
```

Nos dois casos, trate os erros 429 (limite de pedidos) e 402 (sem créditos) e mostre a mensagem em português.

## Recomendação, se quiser mudar o arquivo depois

- Troque a ordem de tentativa para: `google/gemini-2.5-flash-image`, depois `google/gemini-3.1-flash-image`, depois `google/gemini-3-pro-image`. Os ids "-preview" não existem mais, então essas duas tentativas sempre falham hoje.
- Também é possível passar a usar o pacote oficial `@lovable.dev/ai-gateway` com `generateImage`. Ele confere os campos de cada modelo e cuida das novas tentativas sozinho.
