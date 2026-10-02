import { useMemo } from "react";
import { Icone } from "./icones";
import { Idade, Relogio } from "./relogio";
import { PILHA_DE_FONTES, larguraDoCartaoDeSaida } from "./medidas";
import type { Selo } from "@/domain/tv/frescor";
import {
  agruparPorLargura,
  paginaDoTique,
  paginar,
  trabalhosPorPagina,
} from "@/domain/tv/paginacao";
import { partirNome, type Medidor } from "@/domain/tv/partir-nome";
import {
  CARTOES_DE_PRAZO,
  type CartaoDeSaida,
  type CartaoGrande,
  type Coluna,
  type EtiquetaDePrazo,
  type LinhaDaFila,
  type Mini,
  type TelaDaOficina as ModeloDaTela,
} from "@/domain/tv/tela";

/**
 * A parede desenhada: cabeçalho, 3 cartões + 4 minis, as 5 colunas, a faixa
 * de baixo. Recebe tudo pronto do domínio (`montarTela`) e só põe no lugar —
 * cada número impresso é um campo do modelo, nunca uma conta feita aqui.
 *
 * O que é da tela e não do domínio: partir nomes que não cabem (precisa de
 * régua), trocar de página (precisa de relógio) e o selo/relógio (precisam do
 * desvio do aparelho).
 */
export type FaixaDaBusca = {
  classe: "vermelha";
  icone: "WifiOff" | "TriangleAlert";
  texto: string;
};

export type PropsDaTela = {
  tela: ModeloDaTela;
  selo: Selo;
  /** por cima da faixa do painel: SEM CONEXÃO / DADO INVÁLIDO */
  faixaDaBusca: FaixaDaBusca | null;
  /** "QUINTA · 01/10/2026" ou "DIA DE EXEMPLO" */
  data: string;
  exemplo: boolean;
  desvioMs: number;
  geradoEmMs: number;
  /** o tique da troca de página (anda só com dado ao vivo) */
  tique: number;
  medir: Medidor | null;
};

const CLASSE_DO_CARTAO: Record<CartaoGrande["k"], string> = {
  atr: "verm",
  hoje: "neon",
  amanha: "azul",
};
/** largura útil dentro da coluna: 368 − 2 de borda − 32 de recuo */
const LARGURA_DA_LINHA = 334;
/** largura útil do trilho do letreiro: 1200 − 28 de recuo */
const LARGURA_DO_TRILHO = 1172;

export function TelaDaOficina(p: PropsDaTela) {
  const faixa = p.faixaDaBusca ?? p.tela.faixa;
  const classeDaTela = ["tela", p.selo.velho ? "velho" : "", p.selo.quieto ? "quieto" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classeDaTela} data-selo={p.selo.tipo}>
      <Cabecalho {...p} />
      {faixa ? (
        <div className={`faixa ${faixa.classe}`} data-faixa={faixa.classe}>
          <Icone nome={faixa.icone} px={28} />
          <span className="fixo">{faixa.texto}</span>
        </div>
      ) : null}
      <Cartoes cartoes={p.tela.cartoes} minis={p.tela.minis} />
      <Maquinas
        colunas={p.tela.colunas}
        temFaixa={faixa !== null}
        tique={p.tique}
        medir={p.medir}
      />
      <Rodape saidas={p.tela.saidas} canto={p.tela.canto} tique={p.tique} medir={p.medir} />
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* 1. cabeçalho                                                               */
/* ------------------------------------------------------------------------- */

export function MarcaETitulo({ data, exemplo }: { data: string; exemplo: boolean }) {
  return (
    <div className="esq">
      <div className="marca fixo">
        BE<i>X</i>
        <span>PRINT</span>
      </div>
      <div className="div" />
      <div>
        <div className={`sobre cx fixo ${exemplo ? "exemplo" : ""}`}>{data}</div>
        <div className="titulo cx fixo">Máquinas agora</div>
      </div>
    </div>
  );
}

export function SeloDeIdade({
  selo,
  desvioMs,
  geradoEmMs,
}: {
  selo: Selo;
  desvioMs: number;
  geradoEmMs: number;
}) {
  const idade = selo.idade !== null ? <Idade desvioMs={desvioMs} geradoEmMs={geradoEmMs} /> : null;
  if (selo.tipo === "vivo") {
    return (
      <div className="selo vivo fixo" data-selo-texto>
        <span className="pulsa" style={{ display: "flex" }}>
          <Icone nome="Wifi" px={26} />
        </span>
        <span>
          {selo.texto} · {idade}
        </span>
      </div>
    );
  }
  const icone =
    selo.tipo === "sem_conexao" ? "WifiOff" : selo.tipo === "carregando" ? "Clock" : "CircleAlert";
  return (
    <div className={`chip ${selo.cor} fixo`} data-selo-texto>
      <Icone nome={icone} px={24} />
      <span>
        {selo.texto}
        {idade ? <> · {idade}</> : null}
      </span>
    </div>
  );
}

function Cabecalho(p: PropsDaTela) {
  return (
    <header className="cab">
      <MarcaETitulo data={p.data} exemplo={p.exemplo} />
      <div className="dir">
        {p.tela.chips.map((c) => (
          <div key={c.texto} className={`chip ${c.cor} fixo esmaece`}>
            <span>{c.texto}</span>
          </div>
        ))}
        <SeloDeIdade selo={p.selo} desvioMs={p.desvioMs} geradoEmMs={p.geradoEmMs} />
        <Relogio desvioMs={p.desvioMs} />
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------------- */
/* 2. cartões                                                                 */
/* ------------------------------------------------------------------------- */

function Fichas({ fichas, nome }: { fichas: Mini["fichas"]; nome: string }) {
  return (
    <>
      {CARTOES_DE_PRAZO.map((z) => {
        const n = fichas[z.k];
        if (!n) return null;
        return (
          <span key={z.k} className={`pc ${z.k}`}>
            <i>
              <Icone nome={z.icone} px={20} />
              <b data-ficha={z.k} data-mini={nome}>
                {n}
              </b>
            </i>
          </span>
        );
      })}
    </>
  );
}

function Cartoes({ cartoes, minis }: { cartoes: CartaoGrande[]; minis: Mini[] }) {
  return (
    <section className="kpis">
      <div className="grandes">
        {cartoes.map((c) => (
          <div
            key={c.k}
            className={`grande ${CLASSE_DO_CARTAO[c.k]} ${c.zero ? "zero" : ""} ${c.pulsa ? "pulsa" : ""} esmaece`}
            data-cartao={c.k}
          >
            <div className="rot cx fixo">
              <Icone nome={c.icone} px={26} />
              <span>{c.nome}</span>
            </div>
            <div className="num" data-total>
              {c.total}
            </div>
            <div className="sub cx fixo">{c.sub || " "}</div>
          </div>
        ))}
      </div>
      <div className="minis">
        {minis.map((m) => (
          <div
            key={m.chave}
            className={`mini ${m.alerta ? "alerta" : ""} esmaece`}
            data-mini={m.chave}
          >
            <div className="l1">
              <span className="n" data-total>
                {m.total}
              </span>
              <div className="d">
                {m.chave === "sem_maquina" ? (
                  <>
                    {m.destaque && !m.destaque.includes("+") ? (
                      <span className="s os fixo">{m.destaque}</span>
                    ) : null}
                    <Fichas fichas={m.fichas} nome={m.chave} />
                    {m.destaque && m.destaque.includes("+") ? (
                      <span className="s os some fixo">{m.destaque}</span>
                    ) : null}
                  </>
                ) : (
                  <>
                    <Fichas fichas={m.fichas} nome={m.chave} />
                    {m.apoio ? <span className="s some fixo">{m.apoio}</span> : null}
                  </>
                )}
              </div>
            </div>
            <div className="r cx fixo">{m.rotulo}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* 3. as cinco colunas                                                        */
/* ------------------------------------------------------------------------- */

function Etiqueta({ prazo, os }: { prazo: EtiquetaDePrazo | null; os: number }) {
  if (!prazo) return null;
  return (
    <span className={`t ${prazo.k}`} data-prazo={prazo.k} data-os={os}>
      {prazo.k === "atr" ? <Icone nome="TriangleAlert" px={22} /> : null}
      {prazo.texto}
    </span>
  );
}

const F_NUMERO = `800 28px ${PILHA_DE_FONTES}`;
const F_MARCA = `700 24px ${PILHA_DE_FONTES}`;
const F_ETIQUETA = `800 24px ${PILHA_DE_FONTES}`;

/** Quanto a linha de cima do trabalho já gasta antes de a cabeça do nome entrar. */
function ocupadoNaLinhaDeCima(f: LinhaDaFila, medir: Medidor): number {
  let usado = medir(`#${f.osNumero}`, F_NUMERO);
  if (f.marca) usado += 8 - 2 + medir(f.marca, F_MARCA);
  if (f.prazo) usado += 8 + (f.prazo.k === "atr" ? 22 + 3 : 0) + medir(f.prazo.texto, F_ETIQUETA);
  if (f.direita) usado += 8 + medir(f.direita, F_ETIQUETA);
  return usado;
}

function Trabalho({ f, medir }: { f: LinhaDaFila; medir: Medidor | null }) {
  const nome = useMemo(() => {
    if (!medir) return { cabeca: null, resto: f.produto, cortado: false };
    return partirNome(f.produto, {
      larguraDaLinha: LARGURA_DA_LINHA,
      livreNaLinhaDeCima: LARGURA_DA_LINHA - ocupadoNaLinhaDeCima(f, medir) - 8,
      medir,
    });
  }, [f, medir]);
  return (
    <div
      className={`item ${f.prazo?.k === "atr" ? "atr" : ""} ${f.classe}`}
      data-os={f.osNumero}
      data-cortado={nome.cortado || undefined}
    >
      <div className="l1">
        <span className="n">#{f.osNumero}</span>
        {f.marca ? <span className="pt">{f.marca}</span> : null}
        <Etiqueta prazo={f.prazo} os={f.osNumero} />
        {nome.cabeca ? <span className="ca">{nome.cabeca}</span> : null}
        {f.direita ? <span className="h some">{f.direita}</span> : null}
      </div>
      <div className="p corta">{nome.resto}</div>
    </div>
  );
}

function ColunaDaMaquina({
  c,
  porPagina,
  tique,
  medir,
}: {
  c: Coluna;
  porPagina: number;
  tique: number;
  medir: Medidor | null;
}) {
  const paginas = useMemo(() => paginar(c.fila, porPagina), [c.fila, porPagina]);
  const pagina = paginaDoTique(tique, paginas.length);
  const a = c.agora;
  return (
    <div
      className={`maq ${c.classe} ${c.estourou ? "estourou" : ""} esmaece`}
      data-maq={c.id}
      data-estado={c.estado}
    >
      <div className="filete" style={{ background: c.identidade.cor }} />
      <div className="topo">
        <div className="nomel">
          <div className="nome cx fixo">
            <Icone nome={c.identidade.icone} px={28} cor={c.identidade.cor} />
            <span>{c.identidade.curto}</span>
          </div>
          <div className="fila fixo">
            <Icone nome="Layers" px={22} />
            <span data-fila-total>{c.filaTotal}</span>
          </div>
        </div>
        <div className="barra">
          <i style={{ width: `${c.pct}%` }} />
        </div>
      </div>
      <div className="estado">
        <div className="palavra fixo">{c.palavra}</div>
        <div className="desde fixo">{c.desde}</div>
      </div>
      <div className="agora">
        {a ? (
          <>
            <div className="osl">
              <span
                className={`os fixo ${a.prazo?.k === "atr" ? "atr" : ""}`}
                data-os-agora={a.osNumero}
              >
                OS #{a.osNumero}
              </span>
              {a.parte ? <span className="parte some">{a.parte}</span> : null}
            </div>
            <div className="prod">{a.produto}</div>
            <div className="prev">
              <Etiqueta prazo={a.prazo} os={a.osNumero} />
              <span className={`nota some ${a.estourou ? "estourou" : ""}`}>{a.nota}</span>
            </div>
          </>
        ) : c.dica ? (
          <div className="dica">
            Para acender esta máquina: no celular, abra a OS e aperte <b>Começar</b>.
          </div>
        ) : (
          c.notas.map((n) => (
            <div key={n} className="nota1 fixo">
              {n}
            </div>
          ))
        )}
      </div>
      <div className="lista">
        <div className="rotlista">
          <span className="tit fixo">{c.fila.length ? "DEPOIS" : "FILA VAZIA"}</span>
          {c.aviso ? (
            <span className={`inf fixo ${c.aviso.ambar ? "ambar" : ""}`}>{c.aviso.texto}</span>
          ) : null}
        </div>
        <div className="janela" data-pagina={pagina + 1} data-paginas={paginas.length}>
          {paginas[pagina].map((f) => (
            <Trabalho key={f.chave} f={f} medir={medir} />
          ))}
        </div>
      </div>
      {paginas.length > 1 ? (
        <div className="pontos">
          {paginas.map((_, i) => (
            <i key={i} className={i === pagina ? "a" : ""} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Maquinas({
  colunas,
  temFaixa,
  tique,
  medir,
}: {
  colunas: Coluna[];
  temFaixa: boolean;
  tique: number;
  medir: Medidor | null;
}) {
  const porPagina = trabalhosPorPagina(temFaixa);
  return (
    <section className="maquinas">
      {colunas.map((c) => (
        <ColunaDaMaquina key={c.id} c={c} porPagina={porPagina} tique={tique} medir={medir} />
      ))}
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* 4. letreiro e canto                                                        */
/* ------------------------------------------------------------------------- */

function Rodape({
  saidas,
  canto,
  tique,
  medir,
}: {
  saidas: CartaoDeSaida[];
  canto: ModeloDaTela["canto"];
  tique: number;
  medir: Medidor | null;
}) {
  const grupos = useMemo(() => {
    if (!medir || saidas.length === 0) return [saidas.map((_, i) => i)];
    return agruparPorLargura(
      saidas.map((s) => larguraDoCartaoDeSaida(s, medir)),
      LARGURA_DO_TRILHO,
    );
  }, [saidas, medir]);
  const pagina = paginaDoTique(tique, grupos.length);
  return (
    <footer className="rodape esmaece">
      <div className="etq cx fixo">
        <Icone nome="Truck" px={28} />
        <span>Saídas</span>
      </div>
      <div className="trilho" data-pagina={pagina + 1} data-paginas={grupos.length}>
        {saidas.length === 0 ? (
          <span className="vazio fixo">Nenhuma saída marcada para hoje ou amanhã</span>
        ) : (
          grupos[pagina].map((i) => {
            const s = saidas[i];
            return (
              <div key={s.chave} className="saida" data-saida={s.chave}>
                <div className="tarja" style={{ background: s.cor }} />
                <div className="cx2">
                  <div className={`q ${s.quando} fixo`}>{s.quandoTexto}</div>
                  <div className="oq fixo">{s.oQue}</div>
                </div>
              </div>
            );
          })
        )}
        {grupos.length > 1 ? (
          <span className="pag fixo">{`${pagina + 1}/${grupos.length}`}</span>
        ) : null}
      </div>
      <div className="canto">
        <div className="c1 cx fixo">
          <Icone nome="BellRing" px={24} />
          <span>{canto.c1}</span>
        </div>
        <div className="c2 corta">{canto.c2}</div>
      </div>
    </footer>
  );
}
