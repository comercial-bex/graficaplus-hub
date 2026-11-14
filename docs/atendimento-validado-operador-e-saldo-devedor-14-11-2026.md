# Atendimento validado, operador e saldo devedor (14/11/2026)

## O pedido do dono

- **Atendimento validado.** O atendimento fecha o pacote e o gestor confere. Estando
  tudo certo, o gestor autoriza, escolhe quem faz a criação e "avança". Pode fazer
  isso pelo celular ou pelo computador. Hoje essa aprovação acontece no grupo do
  WhatsApp. Pediu também: "não marque sempre pelo papel da pessoa", ou seja, quem
  escolhe é o gestor, não o cadastro.
- **Operador.** "Dentro de um modal, eu seleciono um operador, o Fernando, para seguir
  para ele." A produção faz a peça e a devolve ao atendimento, que entrega.
- **Saldo devedor.** "Cliente que vai ficar devendo: o gerente tem que autorizar. Só
  quem pode autorizar é o gestor."

## A regra de negócio

```
Atendimento ──(gestor valida e escolhe a criação)──▶ Atendimento validado ──▶ Criação
   │                                                                          │
   └─ quem não é gestor: "Pedir a validação ao gestor" (aviso no grupo)       ▼
                                                    Fila de produção ◀── escolhe o operador
                                                          │
                                         Produção → Acabamento → Pronta ──▶ aviso ao atendimento
```

### 1. Atendimento validado

É uma coluna nova do quadro, entre Atendimento e Criação. Usa o status
`briefing_ok`, que existia no enum e nenhuma OS usava.

- **A trava.** Uma OS de venda não sai do Atendimento para nenhuma etapa adiante sem
  a validação do gestor (código `atendimento_nao_validado`, em `os_bloqueios_para`).
  - A trava vale em qualquer caminho: arrastar, seletor, painel ou RPC.
  - Ficam de fora a OS de impressão 3D (não passa pela criação) e a OS interna.
- **Quem valida.** Só o gestor ou o admin (`validar_atendimento`). O gestor escolhe
  quem faz a criação entre **todas** as pessoas da equipe; os de papel "designer"
  aparecem primeiro. Pode deixar um recado para a criação.
- **Onde se valida.**
  - Pela ficha da OS: a pendência "Atendimento não validado pelo gestor" tem o botão
    "Validar atendimento".
  - Arrastando o cartão para a coluna, o que abre a mesma janela.
  - Escolhendo "Atendimento validado" no seletor da ficha.
- **Quem não é gestor** vê "Pedir a validação ao gestor" (`pedir_aval_do_gestor`).
  Isso manda aviso ao grupo da equipe citando os gestores, no máximo um a cada 15
  minutos por OS.
- **Registro.** Fica em `os_autorizacoes` (quem, quando, a criação escolhida e o
  recado). A ficha mostra "Atendimento validado por … em … · criação com …".

### 2. Operador

- **Mandar para a fila.** Abre a escolha do operador. Isso vale para:
  - o botão "Enviar para a fila de produção";
  - arrastar o cartão para a coluna da fila;
  - escolher "Fila de produção" no seletor.

  O operador e a mudança de etapa vão juntos (`mandar_para_fila_de_producao`): se uma
  trava barrar, nada fica gravado e a janela mostra o que falta.
- **Trocar o operador.** Na fila, na máquina e no acabamento, a ficha tem "Trocar
  operador" (`definir_operador_da_os`).
- **Minha oficina.** O que foi mandado para quem está logado aparece primeiro, com o
  selo "Para você".
- **Pronta → atendimento.** Quando a OS entra na saída (aguardando retirada,
  aguardando entrega ou instalação), o grupo recebe "Pronta para entregar", citando
  o vendedor e o responsável da OS, que combinam com o cliente. O cliente tem o aviso
  dele, que já existia.

### 3. Saldo devedor

- A trava "Nenhum pagamento registrado" ganhou uma saída: o gestor autoriza o cliente
  a ficar devendo, com o motivo (`autorizar_saldo_devedor`).
- O valor em aberto no momento fica registrado. A coluna fica fechada ao navegador,
  como o `valor_total` da OS.
- Quem não é gestor vê "Vai ficar devendo: pedir ao gestor", que manda aviso no grupo.
- O aviso de autorização vai ao grupo **sem o valor**: o operador também lê o grupo e
  não vê preço.

## Os avisos no grupo da equipe

Todos usam o mesmo grupo do aviso de lead (`grupo_equipe_destino()`).

- Citam a pessoa com "@" quando ela tem celular no cadastro. Hoje o Harison (admin)
  não tem celular e por isso não é citado.
- Trazem o link `https://bexprint.com.br/kanban?os=…`, que abre a ficha da OS no
  quadro.
- O aviso nunca derruba o passo: se falhar, fica o WARNING no log e a OS anda.

| Quando | Título | Cita |
| --- | --- | --- |
| Pedido de validação | 🟡 Atendimento para validar | gestores |
| Validado | ✅ Atendimento validado | quem faz a criação |
| Pedido de saldo devedor | 💳 Cliente vai ficar devendo | gestores |
| Saldo devedor autorizado | 💳 Pode produzir sem a entrada | — |
| Na fila | 🏭 Na fila de produção | o operador |
| Operador trocado | 🔁 Operador trocado | o operador novo |
| Pronta | 📦 Pronta para entregar | vendedor e responsável |

## Segurança

- **Quem grava.** A tabela `os_autorizacoes` só é gravada pelas funções. O navegador
  lê as colunas de quem, quando e por quê, e não lê o valor.
- **Quem chama.** As funções que o navegador chama conferem o papel por dentro.
  `eh_gestor`, as funções do aviso e o gatilho só executam como `service_role`.
- **Permissões conferidas.** Todas as funções novas foram revogadas de `PUBLIC`,
  `anon` e `authenticated`, e o resultado foi conferido com `has_function_privilege`
  na própria migração.

## Ensaio no banco (14/11/2026, com rollback)

- **OS 221 (Atendimento).** Ficou barrada por "Atendimento não validado pelo gestor".
  - A Maiara (vendedora) não conseguiu validar (42501) e pediu pelo grupo, que citou
    o gestor. O segundo pedido, dentro de 15 minutos, não repetiu o aviso.
  - O Raymison (gestor) validou com a Maiara na criação. A OS foi para `briefing_ok`,
    a trava sumiu e o grupo recebeu o aviso citando a Maiara.
- **OS 226.** A Maiara não conseguiu autorizar o saldo devedor; o gestor conseguiu.
  - A fila com o Fernando citou o Fernando.
  - A troca para a Maiara citou a Maiara.
- **OS 170.** Ao ficar pronta (retirada), citou o vendedor e o responsável.
