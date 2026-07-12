export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agenda_maquinas: {
        Row: {
          created_at: string
          created_by: string | null
          descricao: string | null
          fim: string
          id: string
          inicio: string
          item_os_id: string | null
          maquina_id: string
          observacoes: string | null
          operador_id: string | null
          os_id: string | null
          prioridade: number
          status: string
          titulo: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          fim: string
          id?: string
          inicio: string
          item_os_id?: string | null
          maquina_id: string
          observacoes?: string | null
          operador_id?: string | null
          os_id?: string | null
          prioridade?: number
          status?: string
          titulo: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          fim?: string
          id?: string
          inicio?: string
          item_os_id?: string | null
          maquina_id?: string
          observacoes?: string | null
          operador_id?: string | null
          os_id?: string | null
          prioridade?: number
          status?: string
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agenda_maquinas_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agenda_maquinas_item_os_id_fkey"
            columns: ["item_os_id"]
            isOneToOne: false
            referencedRelation: "itens_os"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agenda_maquinas_item_os_id_fkey"
            columns: ["item_os_id"]
            isOneToOne: false
            referencedRelation: "itens_os_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agenda_maquinas_item_os_id_fkey"
            columns: ["item_os_id"]
            isOneToOne: false
            referencedRelation: "itens_os_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agenda_maquinas_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: false
            referencedRelation: "maquinas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agenda_maquinas_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: false
            referencedRelation: "rel_producao_por_maquina"
            referencedColumns: ["maquina_id"]
          },
          {
            foreignKeyName: "agenda_maquinas_operador_id_fkey"
            columns: ["operador_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agenda_maquinas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agenda_maquinas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agenda_maquinas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agenda_maquinas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "agenda_maquinas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "agenda_maquinas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "agenda_maquinas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
        ]
      }
      apontamentos_producao: {
        Row: {
          created_at: string
          etapa: string
          finalizado_em: string | null
          id: string
          iniciado_em: string
          maquina_id: string | null
          observacoes: string | null
          operador_id: string | null
          os_id: string | null
          quantidade: number
          setor: string | null
        }
        Insert: {
          created_at?: string
          etapa: string
          finalizado_em?: string | null
          id?: string
          iniciado_em?: string
          maquina_id?: string | null
          observacoes?: string | null
          operador_id?: string | null
          os_id?: string | null
          quantidade?: number
          setor?: string | null
        }
        Update: {
          created_at?: string
          etapa?: string
          finalizado_em?: string | null
          id?: string
          iniciado_em?: string
          maquina_id?: string | null
          observacoes?: string | null
          operador_id?: string | null
          os_id?: string | null
          quantidade?: number
          setor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "apontamentos_producao_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: false
            referencedRelation: "maquinas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apontamentos_producao_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: false
            referencedRelation: "rel_producao_por_maquina"
            referencedColumns: ["maquina_id"]
          },
          {
            foreignKeyName: "apontamentos_producao_operador_id_fkey"
            columns: ["operador_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apontamentos_producao_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apontamentos_producao_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apontamentos_producao_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apontamentos_producao_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "apontamentos_producao_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "apontamentos_producao_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "apontamentos_producao_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
        ]
      }
      aprovacoes: {
        Row: {
          aprovado: boolean
          arquivo_id: string | null
          canal: Database["public"]["Enums"]["canal_aprovacao"]
          cliente_contato_id: string | null
          created_at: string
          id: string
          observacao: string | null
          orcamento_id: string | null
          os_id: string | null
          tipo: Database["public"]["Enums"]["tipo_aprovacao"]
          usuario_id: string | null
        }
        Insert: {
          aprovado: boolean
          arquivo_id?: string | null
          canal?: Database["public"]["Enums"]["canal_aprovacao"]
          cliente_contato_id?: string | null
          created_at?: string
          id?: string
          observacao?: string | null
          orcamento_id?: string | null
          os_id?: string | null
          tipo: Database["public"]["Enums"]["tipo_aprovacao"]
          usuario_id?: string | null
        }
        Update: {
          aprovado?: boolean
          arquivo_id?: string | null
          canal?: Database["public"]["Enums"]["canal_aprovacao"]
          cliente_contato_id?: string | null
          created_at?: string
          id?: string
          observacao?: string | null
          orcamento_id?: string | null
          os_id?: string | null
          tipo?: Database["public"]["Enums"]["tipo_aprovacao"]
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "aprovacoes_arquivo_id_fkey"
            columns: ["arquivo_id"]
            isOneToOne: false
            referencedRelation: "arquivos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aprovacoes_cliente_contato_id_fkey"
            columns: ["cliente_contato_id"]
            isOneToOne: false
            referencedRelation: "cliente_contatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aprovacoes_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aprovacoes_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aprovacoes_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aprovacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aprovacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aprovacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aprovacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "aprovacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "aprovacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "aprovacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "aprovacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      arquivo_aprovacoes: {
        Row: {
          arquivo_id: string
          canal: string
          cliente_id: string | null
          comentario: string | null
          created_at: string
          decisao: string
          id: string
          referencias: Json
          usuario_id: string | null
        }
        Insert: {
          arquivo_id: string
          canal?: string
          cliente_id?: string | null
          comentario?: string | null
          created_at?: string
          decisao: string
          id?: string
          referencias?: Json
          usuario_id?: string | null
        }
        Update: {
          arquivo_id?: string
          canal?: string
          cliente_id?: string | null
          comentario?: string | null
          created_at?: string
          decisao?: string
          id?: string
          referencias?: Json
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "arquivo_aprovacoes_arquivo_id_fkey"
            columns: ["arquivo_id"]
            isOneToOne: false
            referencedRelation: "arquivos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivo_aprovacoes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivo_aprovacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      arquivo_tokens_externos: {
        Row: {
          arquivo_id: string | null
          created_at: string
          created_by: string | null
          escopo: Json
          expira_em: string
          id: string
          os_id: string | null
          revogado_em: string | null
          token_hash: string
          usado_em: string | null
        }
        Insert: {
          arquivo_id?: string | null
          created_at?: string
          created_by?: string | null
          escopo?: Json
          expira_em: string
          id?: string
          os_id?: string | null
          revogado_em?: string | null
          token_hash: string
          usado_em?: string | null
        }
        Update: {
          arquivo_id?: string | null
          created_at?: string
          created_by?: string | null
          escopo?: Json
          expira_em?: string
          id?: string
          os_id?: string | null
          revogado_em?: string | null
          token_hash?: string
          usado_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "arquivo_tokens_externos_arquivo_id_fkey"
            columns: ["arquivo_id"]
            isOneToOne: false
            referencedRelation: "arquivos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivo_tokens_externos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivo_tokens_externos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivo_tokens_externos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivo_tokens_externos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivo_tokens_externos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "arquivo_tokens_externos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "arquivo_tokens_externos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "arquivo_tokens_externos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
        ]
      }
      arquivos: {
        Row: {
          aprovado_por: string | null
          arquivo_substituido_id: string | null
          ativo: boolean
          bucket: string | null
          caminho: string
          cliente_id: string | null
          conversa_id: string | null
          created_at: string
          created_by: string | null
          data_aprovacao: string | null
          enviado_por: string | null
          final: boolean
          final_producao: boolean
          hash: string | null
          id: string
          mime: string | null
          mime_type: string | null
          nome: string
          observacao: string | null
          os_id: string | null
          os_item_id: string | null
          status: Database["public"]["Enums"]["status_arquivo"]
          substituido_por: string | null
          tamanho: number | null
          tamanho_bytes: number | null
          tarefa_id: string | null
          tipo: Database["public"]["Enums"]["tipo_arquivo"]
          url: string | null
          versao: number
        }
        Insert: {
          aprovado_por?: string | null
          arquivo_substituido_id?: string | null
          ativo?: boolean
          bucket?: string | null
          caminho: string
          cliente_id?: string | null
          conversa_id?: string | null
          created_at?: string
          created_by?: string | null
          data_aprovacao?: string | null
          enviado_por?: string | null
          final?: boolean
          final_producao?: boolean
          hash?: string | null
          id?: string
          mime?: string | null
          mime_type?: string | null
          nome: string
          observacao?: string | null
          os_id?: string | null
          os_item_id?: string | null
          status?: Database["public"]["Enums"]["status_arquivo"]
          substituido_por?: string | null
          tamanho?: number | null
          tamanho_bytes?: number | null
          tarefa_id?: string | null
          tipo?: Database["public"]["Enums"]["tipo_arquivo"]
          url?: string | null
          versao?: number
        }
        Update: {
          aprovado_por?: string | null
          arquivo_substituido_id?: string | null
          ativo?: boolean
          bucket?: string | null
          caminho?: string
          cliente_id?: string | null
          conversa_id?: string | null
          created_at?: string
          created_by?: string | null
          data_aprovacao?: string | null
          enviado_por?: string | null
          final?: boolean
          final_producao?: boolean
          hash?: string | null
          id?: string
          mime?: string | null
          mime_type?: string | null
          nome?: string
          observacao?: string | null
          os_id?: string | null
          os_item_id?: string | null
          status?: Database["public"]["Enums"]["status_arquivo"]
          substituido_por?: string | null
          tamanho?: number | null
          tamanho_bytes?: number | null
          tarefa_id?: string | null
          tipo?: Database["public"]["Enums"]["tipo_arquivo"]
          url?: string | null
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "arquivos_aprovado_por_fkey"
            columns: ["aprovado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivos_arquivo_substituido_id_fkey"
            columns: ["arquivo_substituido_id"]
            isOneToOne: false
            referencedRelation: "arquivos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivos_enviado_por_fkey"
            columns: ["enviado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "arquivos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "arquivos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "arquivos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "arquivos_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivos_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivos_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivos_substituido_por_fkey"
            columns: ["substituido_por"]
            isOneToOne: false
            referencedRelation: "arquivos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivos_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "os_tarefas"
            referencedColumns: ["id"]
          },
        ]
      }
      automacao_execucoes: {
        Row: {
          automacao_id: string | null
          entrada: Json
          erro: string | null
          executado_em: string
          id: string
          referencia_id: string | null
          referencia_tipo: string | null
          resultado: Json
          status: string
        }
        Insert: {
          automacao_id?: string | null
          entrada?: Json
          erro?: string | null
          executado_em?: string
          id?: string
          referencia_id?: string | null
          referencia_tipo?: string | null
          resultado?: Json
          status?: string
        }
        Update: {
          automacao_id?: string | null
          entrada?: Json
          erro?: string | null
          executado_em?: string
          id?: string
          referencia_id?: string | null
          referencia_tipo?: string | null
          resultado?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "automacao_execucoes_automacao_id_fkey"
            columns: ["automacao_id"]
            isOneToOne: false
            referencedRelation: "automacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      automacoes: {
        Row: {
          acoes: Json
          ativa: boolean
          canal: string
          condicoes: Json
          created_at: string
          created_by: string | null
          descricao: string | null
          gatilho: string
          id: string
          nome: string
          ultima_execucao: string | null
          updated_at: string
        }
        Insert: {
          acoes?: Json
          ativa?: boolean
          canal?: string
          condicoes?: Json
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          gatilho: string
          id?: string
          nome: string
          ultima_execucao?: string | null
          updated_at?: string
        }
        Update: {
          acoes?: Json
          ativa?: boolean
          canal?: string
          condicoes?: Json
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          gatilho?: string
          id?: string
          nome?: string
          ultima_execucao?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automacoes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_itens_modelo: {
        Row: {
          created_at: string
          descricao: string | null
          id: string
          modelo_id: string
          obrigatorio: boolean
          ordem: number
          titulo: string
        }
        Insert: {
          created_at?: string
          descricao?: string | null
          id?: string
          modelo_id: string
          obrigatorio?: boolean
          ordem?: number
          titulo: string
        }
        Update: {
          created_at?: string
          descricao?: string | null
          id?: string
          modelo_id?: string
          obrigatorio?: boolean
          ordem?: number
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_itens_modelo_modelo_id_fkey"
            columns: ["modelo_id"]
            isOneToOne: false
            referencedRelation: "checklist_modelos"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_modelos: {
        Row: {
          ativo: boolean
          created_at: string
          descricao: string | null
          id: string
          nome: string
          produto_id: string | null
          tipo: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          id?: string
          nome: string
          produto_id?: string | null
          tipo?: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          id?: string
          nome?: string
          produto_id?: string | null
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_modelos_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_modelos_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos_operacional"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_respostas: {
        Row: {
          checklist_id: string
          created_at: string
          id: string
          item_modelo_id: string | null
          observacao: string | null
          respondido_em: string | null
          respondido_por: string | null
          valor: boolean
        }
        Insert: {
          checklist_id: string
          created_at?: string
          id?: string
          item_modelo_id?: string | null
          observacao?: string | null
          respondido_em?: string | null
          respondido_por?: string | null
          valor?: boolean
        }
        Update: {
          checklist_id?: string
          created_at?: string
          id?: string
          item_modelo_id?: string | null
          observacao?: string | null
          respondido_em?: string | null
          respondido_por?: string | null
          valor?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "checklist_respostas_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "checklists_os"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_respostas_item_modelo_id_fkey"
            columns: ["item_modelo_id"]
            isOneToOne: false
            referencedRelation: "checklist_itens_modelo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_respostas_respondido_por_fkey"
            columns: ["respondido_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      checklists_os: {
        Row: {
          concluido_em: string | null
          created_at: string
          id: string
          modelo_id: string | null
          os_id: string
          responsavel_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          concluido_em?: string | null
          created_at?: string
          id?: string
          modelo_id?: string | null
          os_id: string
          responsavel_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          concluido_em?: string | null
          created_at?: string
          id?: string
          modelo_id?: string | null
          os_id?: string
          responsavel_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklists_os_modelo_id_fkey"
            columns: ["modelo_id"]
            isOneToOne: false
            referencedRelation: "checklist_modelos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklists_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklists_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklists_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklists_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "checklists_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "checklists_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "checklists_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "checklists_os_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      cliente_contatos: {
        Row: {
          cargo: string | null
          cliente_id: string
          created_at: string
          email: string | null
          id: string
          nome: string
          principal: boolean
          telefone: string | null
        }
        Insert: {
          cargo?: string | null
          cliente_id: string
          created_at?: string
          email?: string | null
          id?: string
          nome: string
          principal?: boolean
          telefone?: string | null
        }
        Update: {
          cargo?: string | null
          cliente_id?: string
          created_at?: string
          email?: string | null
          id?: string
          nome?: string
          principal?: boolean
          telefone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cliente_contatos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          ativo: boolean
          bairro: string | null
          cep: string | null
          cidade: string | null
          cpf_cnpj: string | null
          created_at: string
          created_by: string | null
          documento: string | null
          documento_normalizado: string | null
          email: string | null
          endereco: string | null
          estado: string | null
          id: string
          logo_url: string | null
          nome: string
          nome_fantasia: string | null
          observacoes: string | null
          origem: string | null
          razao_social: string | null
          status: string
          telefone: string | null
          telefone_normalizado: string | null
          tipo: Database["public"]["Enums"]["tipo_cliente"]
          tipo_cliente: Database["public"]["Enums"]["tipo_cliente"]
          ultima_interacao: string | null
          updated_at: string
          vendedor_id: string | null
          whatsapp_principal: string | null
        }
        Insert: {
          ativo?: boolean
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cpf_cnpj?: string | null
          created_at?: string
          created_by?: string | null
          documento?: string | null
          documento_normalizado?: string | null
          email?: string | null
          endereco?: string | null
          estado?: string | null
          id?: string
          logo_url?: string | null
          nome: string
          nome_fantasia?: string | null
          observacoes?: string | null
          origem?: string | null
          razao_social?: string | null
          status?: string
          telefone?: string | null
          telefone_normalizado?: string | null
          tipo?: Database["public"]["Enums"]["tipo_cliente"]
          tipo_cliente?: Database["public"]["Enums"]["tipo_cliente"]
          ultima_interacao?: string | null
          updated_at?: string
          vendedor_id?: string | null
          whatsapp_principal?: string | null
        }
        Update: {
          ativo?: boolean
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cpf_cnpj?: string | null
          created_at?: string
          created_by?: string | null
          documento?: string | null
          documento_normalizado?: string | null
          email?: string | null
          endereco?: string | null
          estado?: string | null
          id?: string
          logo_url?: string | null
          nome?: string
          nome_fantasia?: string | null
          observacoes?: string | null
          origem?: string | null
          razao_social?: string | null
          status?: string
          telefone?: string | null
          telefone_normalizado?: string | null
          tipo?: Database["public"]["Enums"]["tipo_cliente"]
          tipo_cliente?: Database["public"]["Enums"]["tipo_cliente"]
          ultima_interacao?: string | null
          updated_at?: string
          vendedor_id?: string | null
          whatsapp_principal?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clientes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      contas_receber: {
        Row: {
          cliente_id: string
          created_at: string
          id: string
          orcamento_id: string | null
          os_id: string | null
          status: string
          valor_total: number
        }
        Insert: {
          cliente_id: string
          created_at?: string
          id?: string
          orcamento_id?: string | null
          os_id?: string | null
          status?: string
          valor_total: number
        }
        Update: {
          cliente_id?: string
          created_at?: string
          id?: string
          orcamento_id?: string | null
          os_id?: string | null
          status?: string
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "contas_receber_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contas_receber_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contas_receber_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contas_receber_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contas_receber_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contas_receber_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contas_receber_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contas_receber_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "contas_receber_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "contas_receber_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "contas_receber_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
        ]
      }
      custos_operacionais_os: {
        Row: {
          categoria: string
          created_at: string
          data: string
          id: string
          origem: string
          os_id: string
          os_item_id: string | null
          quantidade: number
          tarefa_id: string | null
          total: number | null
          usuario_id: string | null
          valor_unitario: number
        }
        Insert: {
          categoria: string
          created_at?: string
          data?: string
          id?: string
          origem: string
          os_id: string
          os_item_id?: string | null
          quantidade?: number
          tarefa_id?: string | null
          total?: number | null
          usuario_id?: string | null
          valor_unitario?: number
        }
        Update: {
          categoria?: string
          created_at?: string
          data?: string
          id?: string
          origem?: string
          os_id?: string
          os_item_id?: string | null
          quantidade?: number
          tarefa_id?: string | null
          total?: number | null
          usuario_id?: string | null
          valor_unitario?: number
        }
        Relationships: [
          {
            foreignKeyName: "custos_operacionais_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custos_operacionais_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custos_operacionais_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custos_operacionais_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "custos_operacionais_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "custos_operacionais_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "custos_operacionais_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "custos_operacionais_os_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custos_operacionais_os_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custos_operacionais_os_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custos_operacionais_os_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "os_tarefas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custos_operacionais_os_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "vw_tarefas_kanban"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custos_operacionais_os_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      documentos_gerados: {
        Row: {
          caminho: string
          created_at: string
          gerado_por: string | null
          id: string
          numero: number | null
          referencia_id: string
          tamanho_bytes: number | null
          tipo: string
          variante: string
        }
        Insert: {
          caminho: string
          created_at?: string
          gerado_por?: string | null
          id?: string
          numero?: number | null
          referencia_id: string
          tamanho_bytes?: number | null
          tipo: string
          variante?: string
        }
        Update: {
          caminho?: string
          created_at?: string
          gerado_por?: string | null
          id?: string
          numero?: number | null
          referencia_id?: string
          tamanho_bytes?: number | null
          tipo?: string
          variante?: string
        }
        Relationships: []
      }
      entregas_instalacoes: {
        Row: {
          assinatura: Json
          checklist: Json
          comprovante: Json
          created_at: string
          data_agendada: string | null
          data_realizada: string | null
          endereco: string | null
          fotos: Json
          id: string
          instalador_id: string | null
          janela_fim: string | null
          janela_inicio: string | null
          observacoes: string | null
          ocorrencia: string | null
          os_id: string | null
          os_item_id: string | null
          responsavel_id: string | null
          rota: Json
          status: string
          tipo: string
        }
        Insert: {
          assinatura?: Json
          checklist?: Json
          comprovante?: Json
          created_at?: string
          data_agendada?: string | null
          data_realizada?: string | null
          endereco?: string | null
          fotos?: Json
          id?: string
          instalador_id?: string | null
          janela_fim?: string | null
          janela_inicio?: string | null
          observacoes?: string | null
          ocorrencia?: string | null
          os_id?: string | null
          os_item_id?: string | null
          responsavel_id?: string | null
          rota?: Json
          status?: string
          tipo?: string
        }
        Update: {
          assinatura?: Json
          checklist?: Json
          comprovante?: Json
          created_at?: string
          data_agendada?: string | null
          data_realizada?: string | null
          endereco?: string | null
          fotos?: Json
          id?: string
          instalador_id?: string | null
          janela_fim?: string | null
          janela_inicio?: string | null
          observacoes?: string | null
          ocorrencia?: string | null
          os_id?: string | null
          os_item_id?: string | null
          responsavel_id?: string | null
          rota?: Json
          status?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "entregas_instalacoes_instalador_id_fkey"
            columns: ["instalador_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entregas_instalacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entregas_instalacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entregas_instalacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entregas_instalacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "entregas_instalacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "entregas_instalacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "entregas_instalacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "entregas_instalacoes_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entregas_instalacoes_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entregas_instalacoes_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entregas_instalacoes_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      estoque_inventarios: {
        Row: {
          created_at: string
          id: string
          lote_id: string | null
          material_id: string
          motivo: string
          quantidade_anterior: number
          quantidade_nova: number
          usuario_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          lote_id?: string | null
          material_id: string
          motivo: string
          quantidade_anterior: number
          quantidade_nova: number
          usuario_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          lote_id?: string | null
          material_id?: string
          motivo?: string
          quantidade_anterior?: number
          quantidade_nova?: number
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estoque_inventarios_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "material_lotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_inventarios_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_inventarios_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_inventarios_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_inventarios_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "vw_estoque_critico"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "estoque_inventarios_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      estoque_reservas: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          lote_id: string | null
          material_id: string
          os_id: string
          os_item_id: string | null
          quantidade: number
          quantidade_baixada: number
          status: string
          tarefa_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          lote_id?: string | null
          material_id: string
          os_id: string
          os_item_id?: string | null
          quantidade: number
          quantidade_baixada?: number
          status?: string
          tarefa_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          lote_id?: string | null
          material_id?: string
          os_id?: string
          os_item_id?: string | null
          quantidade?: number
          quantidade_baixada?: number
          status?: string
          tarefa_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estoque_reservas_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_reservas_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "material_lotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_reservas_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_reservas_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_reservas_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_reservas_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "vw_estoque_critico"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "estoque_reservas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_reservas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_reservas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_reservas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "estoque_reservas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "estoque_reservas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "estoque_reservas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "estoque_reservas_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_reservas_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_reservas_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_reservas_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "os_tarefas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_reservas_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "vw_tarefas_kanban"
            referencedColumns: ["id"]
          },
        ]
      }
      eventos_negocio: {
        Row: {
          cliente_id: string | null
          created_at: string
          dados_anteriores: Json | null
          dados_posteriores: Json | null
          descricao: string | null
          entidade: string
          entidade_id: string
          id: string
          origem: string
          os_id: string | null
          tipo: string
          titulo: string
          usuario_id: string | null
        }
        Insert: {
          cliente_id?: string | null
          created_at?: string
          dados_anteriores?: Json | null
          dados_posteriores?: Json | null
          descricao?: string | null
          entidade: string
          entidade_id: string
          id?: string
          origem?: string
          os_id?: string | null
          tipo: string
          titulo: string
          usuario_id?: string | null
        }
        Update: {
          cliente_id?: string | null
          created_at?: string
          dados_anteriores?: Json | null
          dados_posteriores?: Json | null
          descricao?: string | null
          entidade?: string
          entidade_id?: string
          id?: string
          origem?: string
          os_id?: string | null
          tipo?: string
          titulo?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "eventos_negocio_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      item_os_custos: {
        Row: {
          custo_unitario: number
          item_os_id: string
          updated_at: string
          valor_total: number
          valor_unitario: number
        }
        Insert: {
          custo_unitario?: number
          item_os_id: string
          updated_at?: string
          valor_total?: number
          valor_unitario?: number
        }
        Update: {
          custo_unitario?: number
          item_os_id?: string
          updated_at?: string
          valor_total?: number
          valor_unitario?: number
        }
        Relationships: [
          {
            foreignKeyName: "item_os_custos_item_os_id_fkey"
            columns: ["item_os_id"]
            isOneToOne: true
            referencedRelation: "itens_os"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_os_custos_item_os_id_fkey"
            columns: ["item_os_id"]
            isOneToOne: true
            referencedRelation: "itens_os_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_os_custos_item_os_id_fkey"
            columns: ["item_os_id"]
            isOneToOne: true
            referencedRelation: "itens_os_operacional"
            referencedColumns: ["id"]
          },
        ]
      }
      itens_os: {
        Row: {
          arquivo_id: string | null
          created_at: string
          custo_unitario: number
          custos_previstos: Json
          descricao: string
          especificacoes: Json
          id: string
          margem_prevista: number | null
          orcamento_item_id: string | null
          ordem: number
          os_id: string
          parametros: Json
          planejamento: Json
          precisa_entrega: boolean
          precisa_instalacao: boolean
          preco_snapshot: number | null
          produto_id: string | null
          produto_snapshot: Json
          quantidade: number
          requer_qualidade: boolean
          unidade: string
          valor_total: number
          valor_unitario: number
        }
        Insert: {
          arquivo_id?: string | null
          created_at?: string
          custo_unitario?: number
          custos_previstos?: Json
          descricao: string
          especificacoes?: Json
          id?: string
          margem_prevista?: number | null
          orcamento_item_id?: string | null
          ordem?: number
          os_id: string
          parametros?: Json
          planejamento?: Json
          precisa_entrega?: boolean
          precisa_instalacao?: boolean
          preco_snapshot?: number | null
          produto_id?: string | null
          produto_snapshot?: Json
          quantidade?: number
          requer_qualidade?: boolean
          unidade?: string
          valor_total?: number
          valor_unitario?: number
        }
        Update: {
          arquivo_id?: string | null
          created_at?: string
          custo_unitario?: number
          custos_previstos?: Json
          descricao?: string
          especificacoes?: Json
          id?: string
          margem_prevista?: number | null
          orcamento_item_id?: string | null
          ordem?: number
          os_id?: string
          parametros?: Json
          planejamento?: Json
          precisa_entrega?: boolean
          precisa_instalacao?: boolean
          preco_snapshot?: number | null
          produto_id?: string | null
          produto_snapshot?: Json
          quantidade?: number
          requer_qualidade?: boolean
          unidade?: string
          valor_total?: number
          valor_unitario?: number
        }
        Relationships: [
          {
            foreignKeyName: "itens_os_orcamento_item_id_fkey"
            columns: ["orcamento_item_id"]
            isOneToOne: false
            referencedRelation: "orcamento_itens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itens_os_orcamento_item_id_fkey"
            columns: ["orcamento_item_id"]
            isOneToOne: false
            referencedRelation: "orcamento_itens_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itens_os_orcamento_item_id_fkey"
            columns: ["orcamento_item_id"]
            isOneToOne: false
            referencedRelation: "orcamento_itens_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "itens_os_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itens_os_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos_operacional"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          campanha: string | null
          cliente_id: string | null
          conversa_id: string | null
          convertido_em: string | null
          created_at: string
          created_by: string | null
          documento: string | null
          email: string | null
          empresa: string | null
          etapa: string
          id: string
          interesse: string | null
          motivo_perda: string | null
          nome: string
          observacoes: string | null
          origem: string
          proxima_acao: string | null
          proxima_acao_em: string | null
          responsavel_id: string | null
          status: string
          telefone: string | null
          telefone_normalizado: string | null
          telefone_original: string | null
          temporario: boolean
          updated_at: string
          valor_potencial: number | null
        }
        Insert: {
          campanha?: string | null
          cliente_id?: string | null
          conversa_id?: string | null
          convertido_em?: string | null
          created_at?: string
          created_by?: string | null
          documento?: string | null
          email?: string | null
          empresa?: string | null
          etapa?: string
          id?: string
          interesse?: string | null
          motivo_perda?: string | null
          nome: string
          observacoes?: string | null
          origem?: string
          proxima_acao?: string | null
          proxima_acao_em?: string | null
          responsavel_id?: string | null
          status?: string
          telefone?: string | null
          telefone_normalizado?: string | null
          telefone_original?: string | null
          temporario?: boolean
          updated_at?: string
          valor_potencial?: number | null
        }
        Update: {
          campanha?: string | null
          cliente_id?: string | null
          conversa_id?: string | null
          convertido_em?: string | null
          created_at?: string
          created_by?: string | null
          documento?: string | null
          email?: string | null
          empresa?: string | null
          etapa?: string
          id?: string
          interesse?: string | null
          motivo_perda?: string | null
          nome?: string
          observacoes?: string | null
          origem?: string
          proxima_acao?: string | null
          proxima_acao_em?: string | null
          responsavel_id?: string | null
          status?: string
          telefone?: string | null
          telefone_normalizado?: string | null
          telefone_original?: string | null
          temporario?: boolean
          updated_at?: string
          valor_potencial?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      logs_auditoria: {
        Row: {
          acao: string
          created_at: string
          detalhes: Json | null
          entidade: string
          entidade_id: string | null
          id: string
          usuario_id: string | null
        }
        Insert: {
          acao: string
          created_at?: string
          detalhes?: Json | null
          entidade: string
          entidade_id?: string | null
          id?: string
          usuario_id?: string | null
        }
        Update: {
          acao?: string
          created_at?: string
          detalhes?: Json | null
          entidade?: string
          entidade_id?: string | null
          id?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "logs_auditoria_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      manutencoes: {
        Row: {
          abertura: string
          created_at: string
          created_by: string | null
          custo: number
          custo_previsto: number
          custo_real: number
          data_conclusao: string | null
          data_inicio: string | null
          data_programada: string | null
          descricao: string | null
          fim_previsto: string | null
          fim_real: string | null
          horas_paradas: number
          horimetro: number | null
          id: string
          inicio_previsto: string | null
          inicio_real: string | null
          maquina_id: string
          motivo: string | null
          observacoes: string | null
          pecas: Json
          recorrencia: Json
          responsavel_id: string | null
          status: string
          tecnico_id: string | null
          tipo: string
          titulo: string
          updated_at: string
        }
        Insert: {
          abertura?: string
          created_at?: string
          created_by?: string | null
          custo?: number
          custo_previsto?: number
          custo_real?: number
          data_conclusao?: string | null
          data_inicio?: string | null
          data_programada?: string | null
          descricao?: string | null
          fim_previsto?: string | null
          fim_real?: string | null
          horas_paradas?: number
          horimetro?: number | null
          id?: string
          inicio_previsto?: string | null
          inicio_real?: string | null
          maquina_id: string
          motivo?: string | null
          observacoes?: string | null
          pecas?: Json
          recorrencia?: Json
          responsavel_id?: string | null
          status?: string
          tecnico_id?: string | null
          tipo?: string
          titulo: string
          updated_at?: string
        }
        Update: {
          abertura?: string
          created_at?: string
          created_by?: string | null
          custo?: number
          custo_previsto?: number
          custo_real?: number
          data_conclusao?: string | null
          data_inicio?: string | null
          data_programada?: string | null
          descricao?: string | null
          fim_previsto?: string | null
          fim_real?: string | null
          horas_paradas?: number
          horimetro?: number | null
          id?: string
          inicio_previsto?: string | null
          inicio_real?: string | null
          maquina_id?: string
          motivo?: string | null
          observacoes?: string | null
          pecas?: Json
          recorrencia?: Json
          responsavel_id?: string | null
          status?: string
          tecnico_id?: string | null
          tipo?: string
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manutencoes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manutencoes_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: false
            referencedRelation: "maquinas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manutencoes_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: false
            referencedRelation: "rel_producao_por_maquina"
            referencedColumns: ["maquina_id"]
          },
          {
            foreignKeyName: "manutencoes_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manutencoes_tecnico_id_fkey"
            columns: ["tecnico_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      maquina_compatibilidades: {
        Row: {
          ativo: boolean
          maquina_id: string
          minutos_limpeza: number
          minutos_setup: number
          produto_id: string
          tipo_operacao: string
        }
        Insert: {
          ativo?: boolean
          maquina_id: string
          minutos_limpeza?: number
          minutos_setup?: number
          produto_id: string
          tipo_operacao: string
        }
        Update: {
          ativo?: boolean
          maquina_id?: string
          minutos_limpeza?: number
          minutos_setup?: number
          produto_id?: string
          tipo_operacao?: string
        }
        Relationships: [
          {
            foreignKeyName: "maquina_compatibilidades_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: false
            referencedRelation: "maquinas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquina_compatibilidades_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: false
            referencedRelation: "rel_producao_por_maquina"
            referencedColumns: ["maquina_id"]
          },
          {
            foreignKeyName: "maquina_compatibilidades_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquina_compatibilidades_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos_operacional"
            referencedColumns: ["id"]
          },
        ]
      }
      maquinas: {
        Row: {
          ativa: boolean
          created_at: string
          id: string
          nome: string
          tipo: string | null
        }
        Insert: {
          ativa?: boolean
          created_at?: string
          id?: string
          nome: string
          tipo?: string | null
        }
        Update: {
          ativa?: boolean
          created_at?: string
          id?: string
          nome?: string
          tipo?: string | null
        }
        Relationships: []
      }
      maquinas_3d_config: {
        Row: {
          acessorios_capitalizados: number
          ativa: boolean
          bico_padrao: string | null
          capacidade_x: number | null
          capacidade_y: number | null
          capacidade_z: number | null
          consumiveis_json: Json
          consumiveis_por_hora: number
          created_at: string
          custo_aquisicao: number
          custo_hora_calculado: number
          custo_hora_manual: number | null
          custo_hora_manual_at: string | null
          custo_hora_manual_usuario_id: string | null
          fabricante: string | null
          frete_aquisicao: number
          horas_acumuladas: number
          horas_produtivas_mensais: number
          infraestrutura_por_hora: number
          instalacao: number
          manutencao_por_hora: number
          maquina_id: string
          metodo_custo_hora: string
          modelo: string | null
          motivo_custo_manual: string | null
          placa_padrao: string | null
          possui_ams: boolean
          potencia_aquecimento_w: number
          potencia_media_w: number
          potencia_standby_w: number
          quantidade_slots: number
          serial: string | null
          tecnologia: string
          updated_at: string
          valor_residual: number
          vida_util_horas: number
        }
        Insert: {
          acessorios_capitalizados?: number
          ativa?: boolean
          bico_padrao?: string | null
          capacidade_x?: number | null
          capacidade_y?: number | null
          capacidade_z?: number | null
          consumiveis_json?: Json
          consumiveis_por_hora?: number
          created_at?: string
          custo_aquisicao?: number
          custo_hora_calculado?: number
          custo_hora_manual?: number | null
          custo_hora_manual_at?: string | null
          custo_hora_manual_usuario_id?: string | null
          fabricante?: string | null
          frete_aquisicao?: number
          horas_acumuladas?: number
          horas_produtivas_mensais?: number
          infraestrutura_por_hora?: number
          instalacao?: number
          manutencao_por_hora?: number
          maquina_id: string
          metodo_custo_hora?: string
          modelo?: string | null
          motivo_custo_manual?: string | null
          placa_padrao?: string | null
          possui_ams?: boolean
          potencia_aquecimento_w?: number
          potencia_media_w?: number
          potencia_standby_w?: number
          quantidade_slots?: number
          serial?: string | null
          tecnologia?: string
          updated_at?: string
          valor_residual?: number
          vida_util_horas?: number
        }
        Update: {
          acessorios_capitalizados?: number
          ativa?: boolean
          bico_padrao?: string | null
          capacidade_x?: number | null
          capacidade_y?: number | null
          capacidade_z?: number | null
          consumiveis_json?: Json
          consumiveis_por_hora?: number
          created_at?: string
          custo_aquisicao?: number
          custo_hora_calculado?: number
          custo_hora_manual?: number | null
          custo_hora_manual_at?: string | null
          custo_hora_manual_usuario_id?: string | null
          fabricante?: string | null
          frete_aquisicao?: number
          horas_acumuladas?: number
          horas_produtivas_mensais?: number
          infraestrutura_por_hora?: number
          instalacao?: number
          manutencao_por_hora?: number
          maquina_id?: string
          metodo_custo_hora?: string
          modelo?: string | null
          motivo_custo_manual?: string | null
          placa_padrao?: string | null
          possui_ams?: boolean
          potencia_aquecimento_w?: number
          potencia_media_w?: number
          potencia_standby_w?: number
          quantidade_slots?: number
          serial?: string | null
          tecnologia?: string
          updated_at?: string
          valor_residual?: number
          vida_util_horas?: number
        }
        Relationships: [
          {
            foreignKeyName: "maquinas_3d_config_custo_hora_manual_usuario_id_fkey"
            columns: ["custo_hora_manual_usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquinas_3d_config_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: true
            referencedRelation: "maquinas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquinas_3d_config_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: true
            referencedRelation: "rel_producao_por_maquina"
            referencedColumns: ["maquina_id"]
          },
        ]
      }
      maquinas_agenda: {
        Row: {
          created_at: string
          created_by: string | null
          fim: string
          fim_previsto: string | null
          fim_real: string | null
          id: string
          inicio: string
          inicio_previsto: string | null
          inicio_real: string | null
          maquina_id: string
          minutos_previstos: number
          minutos_reais: number
          observacoes: string | null
          operador_id: string | null
          origem: string
          os_id: string | null
          os_item_id: string | null
          prioridade: number
          status: string
          tarefa_id: string | null
          titulo: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          fim: string
          fim_previsto?: string | null
          fim_real?: string | null
          id?: string
          inicio: string
          inicio_previsto?: string | null
          inicio_real?: string | null
          maquina_id: string
          minutos_previstos?: number
          minutos_reais?: number
          observacoes?: string | null
          operador_id?: string | null
          origem?: string
          os_id?: string | null
          os_item_id?: string | null
          prioridade?: number
          status?: string
          tarefa_id?: string | null
          titulo: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          fim?: string
          fim_previsto?: string | null
          fim_real?: string | null
          id?: string
          inicio?: string
          inicio_previsto?: string | null
          inicio_real?: string | null
          maquina_id?: string
          minutos_previstos?: number
          minutos_reais?: number
          observacoes?: string | null
          operador_id?: string | null
          origem?: string
          os_id?: string | null
          os_item_id?: string | null
          prioridade?: number
          status?: string
          tarefa_id?: string | null
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "maquinas_agenda_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquinas_agenda_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: false
            referencedRelation: "maquinas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquinas_agenda_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: false
            referencedRelation: "rel_producao_por_maquina"
            referencedColumns: ["maquina_id"]
          },
          {
            foreignKeyName: "maquinas_agenda_operador_id_fkey"
            columns: ["operador_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquinas_agenda_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquinas_agenda_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquinas_agenda_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquinas_agenda_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "maquinas_agenda_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "maquinas_agenda_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "maquinas_agenda_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "maquinas_agenda_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquinas_agenda_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquinas_agenda_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os_operacional"
            referencedColumns: ["id"]
          },
        ]
      }
      materiais: {
        Row: {
          created_at: string
          custo_medio: number | null
          custo_unitario: number | null
          estoque: number
          estoque_maximo: number | null
          estoque_minimo: number
          fornecedor: string | null
          id: string
          localizacao: string | null
          nome: string
          status: string
          unidade: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          custo_medio?: number | null
          custo_unitario?: number | null
          estoque?: number
          estoque_maximo?: number | null
          estoque_minimo?: number
          fornecedor?: string | null
          id?: string
          localizacao?: string | null
          nome: string
          status?: string
          unidade?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          custo_medio?: number | null
          custo_unitario?: number | null
          estoque?: number
          estoque_maximo?: number | null
          estoque_minimo?: number
          fornecedor?: string | null
          id?: string
          localizacao?: string | null
          nome?: string
          status?: string
          unidade?: string
          updated_at?: string
        }
        Relationships: []
      }
      materiais_3d_filamento: {
        Row: {
          armazenamento: string | null
          codigo: string | null
          cor: string | null
          created_at: string
          custo_compra: number
          custo_por_grama_calculado: number | null
          densidade: number | null
          descontos: number
          diametro: number
          exige_secagem: boolean
          fator_aproveitamento: number
          frete_rateado: number
          linha: string | null
          marca: string | null
          material_id: string
          outros_custos: number
          peso_liquido: number
          peso_nominal: number | null
          potencia_secador: number | null
          tara_carretel: number
          temperatura_secagem: number | null
          tempo_secagem: number | null
          tipo: string
          tributos_aquisicao: number
          updated_at: string
        }
        Insert: {
          armazenamento?: string | null
          codigo?: string | null
          cor?: string | null
          created_at?: string
          custo_compra?: number
          custo_por_grama_calculado?: number | null
          densidade?: number | null
          descontos?: number
          diametro?: number
          exige_secagem?: boolean
          fator_aproveitamento?: number
          frete_rateado?: number
          linha?: string | null
          marca?: string | null
          material_id: string
          outros_custos?: number
          peso_liquido?: number
          peso_nominal?: number | null
          potencia_secador?: number | null
          tara_carretel?: number
          temperatura_secagem?: number | null
          tempo_secagem?: number | null
          tipo: string
          tributos_aquisicao?: number
          updated_at?: string
        }
        Update: {
          armazenamento?: string | null
          codigo?: string | null
          cor?: string | null
          created_at?: string
          custo_compra?: number
          custo_por_grama_calculado?: number | null
          densidade?: number | null
          descontos?: number
          diametro?: number
          exige_secagem?: boolean
          fator_aproveitamento?: number
          frete_rateado?: number
          linha?: string | null
          marca?: string | null
          material_id?: string
          outros_custos?: number
          peso_liquido?: number
          peso_nominal?: number | null
          potencia_secador?: number | null
          tara_carretel?: number
          temperatura_secagem?: number | null
          tempo_secagem?: number | null
          tipo?: string
          tributos_aquisicao?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "materiais_3d_filamento_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: true
            referencedRelation: "materiais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materiais_3d_filamento_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: true
            referencedRelation: "materiais_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materiais_3d_filamento_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: true
            referencedRelation: "materiais_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materiais_3d_filamento_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: true
            referencedRelation: "vw_estoque_critico"
            referencedColumns: ["material_id"]
          },
        ]
      }
      material_custos: {
        Row: {
          custo_unitario: number | null
          material_id: string
          updated_at: string
        }
        Insert: {
          custo_unitario?: number | null
          material_id: string
          updated_at?: string
        }
        Update: {
          custo_unitario?: number | null
          material_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_custos_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: true
            referencedRelation: "materiais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_custos_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: true
            referencedRelation: "materiais_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_custos_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: true
            referencedRelation: "materiais_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_custos_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: true
            referencedRelation: "vw_estoque_critico"
            referencedColumns: ["material_id"]
          },
        ]
      }
      material_lotes: {
        Row: {
          codigo: string | null
          created_at: string
          custo_por_grama_snapshot: number | null
          custo_total: number | null
          custo_unitario_snapshot: number
          fornecedor: string | null
          id: string
          localizacao: string | null
          material_id: string
          observacao: string | null
          peso_inicial: number | null
          quantidade: number
          quantidade_reservada: number
          saldo_estimado: number | null
          saldo_medido: number | null
          slot_ams: number | null
          status: string
          tara: number | null
          unidade: string
          validade: string | null
        }
        Insert: {
          codigo?: string | null
          created_at?: string
          custo_por_grama_snapshot?: number | null
          custo_total?: number | null
          custo_unitario_snapshot?: number
          fornecedor?: string | null
          id?: string
          localizacao?: string | null
          material_id: string
          observacao?: string | null
          peso_inicial?: number | null
          quantidade?: number
          quantidade_reservada?: number
          saldo_estimado?: number | null
          saldo_medido?: number | null
          slot_ams?: number | null
          status?: string
          tara?: number | null
          unidade?: string
          validade?: string | null
        }
        Update: {
          codigo?: string | null
          created_at?: string
          custo_por_grama_snapshot?: number | null
          custo_total?: number | null
          custo_unitario_snapshot?: number
          fornecedor?: string | null
          id?: string
          localizacao?: string | null
          material_id?: string
          observacao?: string | null
          peso_inicial?: number | null
          quantidade?: number
          quantidade_reservada?: number
          saldo_estimado?: number | null
          saldo_medido?: number | null
          slot_ams?: number | null
          status?: string
          tara?: number | null
          unidade?: string
          validade?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "material_lotes_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_lotes_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_lotes_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_lotes_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "vw_estoque_critico"
            referencedColumns: ["material_id"]
          },
        ]
      }
      movimentacoes_estoque: {
        Row: {
          created_at: string
          custo_unitario_snapshot: number | null
          id: string
          lote_id: string | null
          material_id: string
          motivo: string | null
          movimentacao_origem_id: string | null
          observacao: string | null
          origem: string | null
          os_id: string | null
          os_item_id: string | null
          quantidade: number
          tarefa_id: string | null
          tipo: string
          unidade: string | null
          usuario_id: string | null
        }
        Insert: {
          created_at?: string
          custo_unitario_snapshot?: number | null
          id?: string
          lote_id?: string | null
          material_id: string
          motivo?: string | null
          movimentacao_origem_id?: string | null
          observacao?: string | null
          origem?: string | null
          os_id?: string | null
          os_item_id?: string | null
          quantidade: number
          tarefa_id?: string | null
          tipo: string
          unidade?: string | null
          usuario_id?: string | null
        }
        Update: {
          created_at?: string
          custo_unitario_snapshot?: number | null
          id?: string
          lote_id?: string | null
          material_id?: string
          motivo?: string | null
          movimentacao_origem_id?: string | null
          observacao?: string | null
          origem?: string | null
          os_id?: string | null
          os_item_id?: string | null
          quantidade?: number
          tarefa_id?: string | null
          tipo?: string
          unidade?: string | null
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "movimentacoes_estoque_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "material_lotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_estoque_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_estoque_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_estoque_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_estoque_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "vw_estoque_critico"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "movimentacoes_estoque_movimentacao_origem_id_fkey"
            columns: ["movimentacao_origem_id"]
            isOneToOne: false
            referencedRelation: "movimentacoes_estoque"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_estoque_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_estoque_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_estoque_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_estoque_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "movimentacoes_estoque_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "movimentacoes_estoque_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "movimentacoes_estoque_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "movimentacoes_estoque_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_estoque_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_estoque_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_estoque_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "os_tarefas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_estoque_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "vw_tarefas_kanban"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_estoque_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      notificacoes_operacionais: {
        Row: {
          acao: Json
          canal: string
          data: string
          entidade: string
          entidade_id: string
          id: string
          lida: boolean
          mensagem: string
          prioridade: string
          tipo: string
          usuario_id: string | null
        }
        Insert: {
          acao?: Json
          canal?: string
          data?: string
          entidade: string
          entidade_id: string
          id?: string
          lida?: boolean
          mensagem: string
          prioridade?: string
          tipo: string
          usuario_id?: string | null
        }
        Update: {
          acao?: Json
          canal?: string
          data?: string
          entidade?: string
          entidade_id?: string
          id?: string
          lida?: boolean
          mensagem?: string
          prioridade?: string
          tipo?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notificacoes_operacionais_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      ocorrencias: {
        Row: {
          acao_corretiva: string | null
          acao_preventiva: string | null
          analisado_por: string | null
          categoria: string | null
          causa: string | null
          created_at: string
          custo: number
          custo_real: number
          descricao: string
          etapa: string | null
          id: string
          material_perdido: Json
          os_id: string | null
          os_item_id: string | null
          quantidade_afetada: number
          registrado_por: string | null
          resolvida: boolean
          resolvida_em: string | null
          retrabalho: boolean
          retrabalho_tarefa_id: string | null
          setor: string | null
          status: string
          tarefa_id: string | null
          tempo_perdido_minutos: number
          tipo: string
          updated_at: string
        }
        Insert: {
          acao_corretiva?: string | null
          acao_preventiva?: string | null
          analisado_por?: string | null
          categoria?: string | null
          causa?: string | null
          created_at?: string
          custo?: number
          custo_real?: number
          descricao: string
          etapa?: string | null
          id?: string
          material_perdido?: Json
          os_id?: string | null
          os_item_id?: string | null
          quantidade_afetada?: number
          registrado_por?: string | null
          resolvida?: boolean
          resolvida_em?: string | null
          retrabalho?: boolean
          retrabalho_tarefa_id?: string | null
          setor?: string | null
          status?: string
          tarefa_id?: string | null
          tempo_perdido_minutos?: number
          tipo: string
          updated_at?: string
        }
        Update: {
          acao_corretiva?: string | null
          acao_preventiva?: string | null
          analisado_por?: string | null
          categoria?: string | null
          causa?: string | null
          created_at?: string
          custo?: number
          custo_real?: number
          descricao?: string
          etapa?: string | null
          id?: string
          material_perdido?: Json
          os_id?: string | null
          os_item_id?: string | null
          quantidade_afetada?: number
          registrado_por?: string | null
          resolvida?: boolean
          resolvida_em?: string | null
          retrabalho?: boolean
          retrabalho_tarefa_id?: string | null
          setor?: string | null
          status?: string
          tarefa_id?: string | null
          tempo_perdido_minutos?: number
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ocorrencias_analisado_por_fkey"
            columns: ["analisado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocorrencias_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocorrencias_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocorrencias_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocorrencias_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "ocorrencias_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "ocorrencias_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "ocorrencias_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "ocorrencias_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocorrencias_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocorrencias_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocorrencias_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocorrencias_retrabalho_tarefa_id_fkey"
            columns: ["retrabalho_tarefa_id"]
            isOneToOne: false
            referencedRelation: "os_tarefas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocorrencias_retrabalho_tarefa_id_fkey"
            columns: ["retrabalho_tarefa_id"]
            isOneToOne: false
            referencedRelation: "vw_tarefas_kanban"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocorrencias_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "os_tarefas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocorrencias_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "vw_tarefas_kanban"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamento_3d_calculos: {
        Row: {
          created_at: string
          created_by: string | null
          custo_acabamento: number
          custo_embalagem: number
          custo_energia: number
          custo_indireto: number
          custo_mao_obra: number
          custo_maquina: number
          custo_material: number
          custo_operacional: number
          custo_risco: number
          custo_terceiros: number
          id: string
          inputs_json: Json
          lucro: number
          margem: number
          markup: number
          nivel_precisao: string
          orcamento_3d_id: string
          preco_minimo: number
          preco_praticado: number
          preco_sugerido: number
          resultados_json: Json
          snapshots_json: Json
          valor_unitario: number
          versao: number
          versao_motor: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          custo_acabamento?: number
          custo_embalagem?: number
          custo_energia?: number
          custo_indireto?: number
          custo_mao_obra?: number
          custo_maquina?: number
          custo_material?: number
          custo_operacional?: number
          custo_risco?: number
          custo_terceiros?: number
          id?: string
          inputs_json: Json
          lucro?: number
          margem?: number
          markup?: number
          nivel_precisao: string
          orcamento_3d_id: string
          preco_minimo?: number
          preco_praticado?: number
          preco_sugerido?: number
          resultados_json: Json
          snapshots_json?: Json
          valor_unitario?: number
          versao: number
          versao_motor: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          custo_acabamento?: number
          custo_embalagem?: number
          custo_energia?: number
          custo_indireto?: number
          custo_mao_obra?: number
          custo_maquina?: number
          custo_material?: number
          custo_operacional?: number
          custo_risco?: number
          custo_terceiros?: number
          id?: string
          inputs_json?: Json
          lucro?: number
          margem?: number
          markup?: number
          nivel_precisao?: string
          orcamento_3d_id?: string
          preco_minimo?: number
          preco_praticado?: number
          preco_sugerido?: number
          resultados_json?: Json
          snapshots_json?: Json
          valor_unitario?: number
          versao?: number
          versao_motor?: string
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_3d_calculos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_3d_calculos_orcamento_3d_id_fkey"
            columns: ["orcamento_3d_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_3d"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamento_3d_consumos: {
        Row: {
          custo_por_grama_snapshot: number
          custo_total: number | null
          extrusor: string | null
          fonte: string
          gramas_extras: number
          gramas_modelo: number
          gramas_preparacao: number
          gramas_purga: number
          gramas_suporte: number
          gramas_torre: number
          gramas_totais: number | null
          id: string
          lote_id: string | null
          material_id: string
          placa_id: string
          slot_ams: number | null
        }
        Insert: {
          custo_por_grama_snapshot?: number
          custo_total?: number | null
          extrusor?: string | null
          fonte?: string
          gramas_extras?: number
          gramas_modelo?: number
          gramas_preparacao?: number
          gramas_purga?: number
          gramas_suporte?: number
          gramas_torre?: number
          gramas_totais?: number | null
          id?: string
          lote_id?: string | null
          material_id: string
          placa_id: string
          slot_ams?: number | null
        }
        Update: {
          custo_por_grama_snapshot?: number
          custo_total?: number | null
          extrusor?: string | null
          fonte?: string
          gramas_extras?: number
          gramas_modelo?: number
          gramas_preparacao?: number
          gramas_purga?: number
          gramas_suporte?: number
          gramas_torre?: number
          gramas_totais?: number | null
          id?: string
          lote_id?: string | null
          material_id?: string
          placa_id?: string
          slot_ams?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_3d_consumos_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "material_lotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_3d_consumos_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_3d_consumos_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_3d_consumos_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_3d_consumos_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "vw_estoque_critico"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "orcamento_3d_consumos_placa_id_fkey"
            columns: ["placa_id"]
            isOneToOne: false
            referencedRelation: "orcamento_3d_placas"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamento_3d_placas: {
        Row: {
          altura_camada: number | null
          arquivo_hash: string | null
          arquivo_id: string | null
          bico: string | null
          dados_brutos_json: Json
          fonte: string
          id: string
          infill: number | null
          maquina_id: string | null
          nome_placa: string | null
          orcamento_3d_id: string
          paredes: number | null
          perfil: string | null
          quantidade_pecas: number
          quantidade_trocas: number
          repeticoes: number
          resfriamento_minutos: number
          retirada_minutos: number
          setup_minutos: number
          sliced_at: string | null
          suporte: boolean
          tempo_estimado_segundos: number
          tempo_real_segundos: number | null
          usa_ams: boolean
        }
        Insert: {
          altura_camada?: number | null
          arquivo_hash?: string | null
          arquivo_id?: string | null
          bico?: string | null
          dados_brutos_json?: Json
          fonte?: string
          id?: string
          infill?: number | null
          maquina_id?: string | null
          nome_placa?: string | null
          orcamento_3d_id: string
          paredes?: number | null
          perfil?: string | null
          quantidade_pecas?: number
          quantidade_trocas?: number
          repeticoes?: number
          resfriamento_minutos?: number
          retirada_minutos?: number
          setup_minutos?: number
          sliced_at?: string | null
          suporte?: boolean
          tempo_estimado_segundos?: number
          tempo_real_segundos?: number | null
          usa_ams?: boolean
        }
        Update: {
          altura_camada?: number | null
          arquivo_hash?: string | null
          arquivo_id?: string | null
          bico?: string | null
          dados_brutos_json?: Json
          fonte?: string
          id?: string
          infill?: number | null
          maquina_id?: string | null
          nome_placa?: string | null
          orcamento_3d_id?: string
          paredes?: number | null
          perfil?: string | null
          quantidade_pecas?: number
          quantidade_trocas?: number
          repeticoes?: number
          resfriamento_minutos?: number
          retirada_minutos?: number
          setup_minutos?: number
          sliced_at?: string | null
          suporte?: boolean
          tempo_estimado_segundos?: number
          tempo_real_segundos?: number | null
          usa_ams?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_3d_placas_arquivo_id_fkey"
            columns: ["arquivo_id"]
            isOneToOne: false
            referencedRelation: "arquivos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_3d_placas_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: false
            referencedRelation: "maquinas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_3d_placas_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: false
            referencedRelation: "rel_producao_por_maquina"
            referencedColumns: ["maquina_id"]
          },
          {
            foreignKeyName: "orcamento_3d_placas_orcamento_3d_id_fkey"
            columns: ["orcamento_3d_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_3d"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamento_3d_servicos: {
        Row: {
          custo: number
          custo_hora: number
          descricao: string | null
          id: string
          minutos: number
          orcamento_3d_id: string
          preco_separado: number | null
          quantidade: number
          responsavel: string | null
          tipo: string
        }
        Insert: {
          custo?: number
          custo_hora?: number
          descricao?: string | null
          id?: string
          minutos?: number
          orcamento_3d_id: string
          preco_separado?: number | null
          quantidade?: number
          responsavel?: string | null
          tipo: string
        }
        Update: {
          custo?: number
          custo_hora?: number
          descricao?: string | null
          id?: string
          minutos?: number
          orcamento_3d_id?: string
          preco_separado?: number | null
          quantidade?: number
          responsavel?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_3d_servicos_orcamento_3d_id_fkey"
            columns: ["orcamento_3d_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_3d"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_3d_servicos_responsavel_fkey"
            columns: ["responsavel"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamento_custos: {
        Row: {
          custo_estimado: number
          desconto_percentual: number
          margem_estimada: number | null
          orcamento_id: string
          updated_at: string
          valor_subtotal: number
          valor_total: number
        }
        Insert: {
          custo_estimado?: number
          desconto_percentual?: number
          margem_estimada?: number | null
          orcamento_id: string
          updated_at?: string
          valor_subtotal?: number
          valor_total?: number
        }
        Update: {
          custo_estimado?: number
          desconto_percentual?: number
          margem_estimada?: number | null
          orcamento_id?: string
          updated_at?: string
          valor_subtotal?: number
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_custos_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: true
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_custos_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: true
            referencedRelation: "orcamentos_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_custos_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: true
            referencedRelation: "orcamentos_operacional"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamento_item_custos: {
        Row: {
          custo_unitario: number
          orcamento_item_id: string
          updated_at: string
          valor_total: number
          valor_unitario: number
        }
        Insert: {
          custo_unitario?: number
          orcamento_item_id: string
          updated_at?: string
          valor_total?: number
          valor_unitario?: number
        }
        Update: {
          custo_unitario?: number
          orcamento_item_id?: string
          updated_at?: string
          valor_total?: number
          valor_unitario?: number
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_item_custos_orcamento_item_id_fkey"
            columns: ["orcamento_item_id"]
            isOneToOne: true
            referencedRelation: "orcamento_itens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_item_custos_orcamento_item_id_fkey"
            columns: ["orcamento_item_id"]
            isOneToOne: true
            referencedRelation: "orcamento_itens_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_item_custos_orcamento_item_id_fkey"
            columns: ["orcamento_item_id"]
            isOneToOne: true
            referencedRelation: "orcamento_itens_operacional"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamento_itens: {
        Row: {
          created_at: string
          custo_previsto: number
          custo_unitario: number
          desconto: number
          descricao: string
          id: string
          margem_prevista: number | null
          orcamento_id: string
          ordem: number
          origem_calculo: string | null
          parametros: Json
          produto_id: string | null
          produto_snapshot: Json
          quantidade: number
          unidade: string
          valor_total: number
          valor_unitario: number
        }
        Insert: {
          created_at?: string
          custo_previsto?: number
          custo_unitario?: number
          desconto?: number
          descricao: string
          id?: string
          margem_prevista?: number | null
          orcamento_id: string
          ordem?: number
          origem_calculo?: string | null
          parametros?: Json
          produto_id?: string | null
          produto_snapshot?: Json
          quantidade?: number
          unidade?: string
          valor_total?: number
          valor_unitario?: number
        }
        Update: {
          created_at?: string
          custo_previsto?: number
          custo_unitario?: number
          desconto?: number
          descricao?: string
          id?: string
          margem_prevista?: number | null
          orcamento_id?: string
          ordem?: number
          origem_calculo?: string | null
          parametros?: Json
          produto_id?: string | null
          produto_snapshot?: Json
          quantidade?: number
          unidade?: string
          valor_total?: number
          valor_unitario?: number
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_itens_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_itens_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_itens_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos_operacional"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamento_versao_itens: {
        Row: {
          created_at: string
          id: string
          orcamento_item_id: string | null
          ordem: number
          snapshot: Json
          versao_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          orcamento_item_id?: string | null
          ordem?: number
          snapshot: Json
          versao_id: string
        }
        Update: {
          created_at?: string
          id?: string
          orcamento_item_id?: string | null
          ordem?: number
          snapshot?: Json
          versao_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_versao_itens_orcamento_item_id_fkey"
            columns: ["orcamento_item_id"]
            isOneToOne: false
            referencedRelation: "orcamento_itens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_versao_itens_orcamento_item_id_fkey"
            columns: ["orcamento_item_id"]
            isOneToOne: false
            referencedRelation: "orcamento_itens_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_versao_itens_orcamento_item_id_fkey"
            columns: ["orcamento_item_id"]
            isOneToOne: false
            referencedRelation: "orcamento_itens_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_versao_itens_versao_id_fkey"
            columns: ["versao_id"]
            isOneToOne: false
            referencedRelation: "orcamento_versoes"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamento_versoes: {
        Row: {
          aprovada_em: string | null
          aprovado_por: string | null
          canal: string | null
          created_at: string
          created_by: string | null
          destinatario: string | null
          enviada_em: string | null
          id: string
          numero_versao: number
          orcamento_id: string
          pdf_url: string | null
          snapshot: Json
          status: string
          valor_total: number
        }
        Insert: {
          aprovada_em?: string | null
          aprovado_por?: string | null
          canal?: string | null
          created_at?: string
          created_by?: string | null
          destinatario?: string | null
          enviada_em?: string | null
          id?: string
          numero_versao: number
          orcamento_id: string
          pdf_url?: string | null
          snapshot: Json
          status?: string
          valor_total?: number
        }
        Update: {
          aprovada_em?: string | null
          aprovado_por?: string | null
          canal?: string | null
          created_at?: string
          created_by?: string | null
          destinatario?: string | null
          enviada_em?: string | null
          id?: string
          numero_versao?: number
          orcamento_id?: string
          pdf_url?: string | null
          snapshot?: Json
          status?: string
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_versoes_aprovado_por_fkey"
            columns: ["aprovado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_versoes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_versoes_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_versoes_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_versoes_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_operacional"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamentos: {
        Row: {
          aprovado_em: string | null
          briefing: string | null
          cliente_id: string
          condicao_pagamento: Json
          contato_id: string | null
          conversa_id: string | null
          created_at: string
          created_by: string | null
          custo_estimado: number
          desconto_percentual: number
          descricao: string | null
          endereco_entrega: Json | null
          enviado_em: string | null
          id: string
          lead_id: string | null
          margem_estimada: number | null
          numero: number
          observacao_cliente: string | null
          observacao_interna: string | null
          observacoes: string | null
          os_id: string | null
          prazo: string | null
          precisa_entrega: boolean
          precisa_instalacao: boolean
          status: Database["public"]["Enums"]["status_orcamento"]
          titulo: string
          updated_at: string
          validade_dias: number
          valor_subtotal: number
          valor_total: number
          vendedor_id: string | null
          versao_aprovada_id: string | null
        }
        Insert: {
          aprovado_em?: string | null
          briefing?: string | null
          cliente_id: string
          condicao_pagamento?: Json
          contato_id?: string | null
          conversa_id?: string | null
          created_at?: string
          created_by?: string | null
          custo_estimado?: number
          desconto_percentual?: number
          descricao?: string | null
          endereco_entrega?: Json | null
          enviado_em?: string | null
          id?: string
          lead_id?: string | null
          margem_estimada?: number | null
          numero?: number
          observacao_cliente?: string | null
          observacao_interna?: string | null
          observacoes?: string | null
          os_id?: string | null
          prazo?: string | null
          precisa_entrega?: boolean
          precisa_instalacao?: boolean
          status?: Database["public"]["Enums"]["status_orcamento"]
          titulo: string
          updated_at?: string
          validade_dias?: number
          valor_subtotal?: number
          valor_total?: number
          vendedor_id?: string | null
          versao_aprovada_id?: string | null
        }
        Update: {
          aprovado_em?: string | null
          briefing?: string | null
          cliente_id?: string
          condicao_pagamento?: Json
          contato_id?: string | null
          conversa_id?: string | null
          created_at?: string
          created_by?: string | null
          custo_estimado?: number
          desconto_percentual?: number
          descricao?: string | null
          endereco_entrega?: Json | null
          enviado_em?: string | null
          id?: string
          lead_id?: string | null
          margem_estimada?: number | null
          numero?: number
          observacao_cliente?: string | null
          observacao_interna?: string | null
          observacoes?: string | null
          os_id?: string | null
          prazo?: string | null
          precisa_entrega?: boolean
          precisa_instalacao?: boolean
          status?: Database["public"]["Enums"]["status_orcamento"]
          titulo?: string
          updated_at?: string
          validade_dias?: number
          valor_subtotal?: number
          valor_total?: number
          vendedor_id?: string | null
          versao_aprovada_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orcamentos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "cliente_contatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "orcamentos_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamentos_3d: {
        Row: {
          cliente_id: string | null
          created_at: string
          created_by: string | null
          descricao: string | null
          id: string
          lead_id: string | null
          moeda: string
          nivel_precisao: string
          orcamento_id: string | null
          prazo: string | null
          preco_comercial: number | null
          preco_nao_arredondado: number | null
          quantidade: number
          status: string
          titulo: string
          updated_at: string
          validade: string | null
          versao_motor: string
        }
        Insert: {
          cliente_id?: string | null
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          id?: string
          lead_id?: string | null
          moeda?: string
          nivel_precisao?: string
          orcamento_id?: string | null
          prazo?: string | null
          preco_comercial?: number | null
          preco_nao_arredondado?: number | null
          quantidade?: number
          status?: string
          titulo: string
          updated_at?: string
          validade?: string | null
          versao_motor: string
        }
        Update: {
          cliente_id?: string | null
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          id?: string
          lead_id?: string | null
          moeda?: string
          nivel_precisao?: string
          orcamento_id?: string | null
          prazo?: string | null
          preco_comercial?: number | null
          preco_nao_arredondado?: number | null
          quantidade?: number
          status?: string
          titulo?: string
          updated_at?: string
          validade?: string | null
          versao_motor?: string
        }
        Relationships: [
          {
            foreignKeyName: "orcamentos_3d_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_3d_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_3d_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_3d_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_3d_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_3d_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_operacional"
            referencedColumns: ["id"]
          },
        ]
      }
      ordens_servico: {
        Row: {
          briefing: string | null
          cliente_id: string
          contato_id: string | null
          created_at: string
          created_by: string | null
          custo_previsto: number
          custo_real: number
          data_entrega_real: string | null
          data_fechamento: string | null
          desconto: number
          designer_id: string | null
          estoque_baixado: boolean
          estoque_baixado_em: string | null
          id: string
          lucro_previsto: number
          lucro_real: number
          maquina_id: string | null
          margem_prevista: number | null
          margem_real: number | null
          numero: number
          numero_os: number | null
          observacoes: string | null
          operador_id: string | null
          orcamento_id: string | null
          ordem_kanban: number
          prazo_cliente: string | null
          prazo_entrega: string | null
          prazo_interno: string | null
          precisa_entrega: boolean
          precisa_instalacao: boolean
          prioridade: number
          produto_id: string | null
          responsavel_id: string | null
          setor_atual: string | null
          status: Database["public"]["Enums"]["status_os"]
          status_arte: string
          status_comercial: string
          status_financeiro: Database["public"]["Enums"]["status_pagamento"]
          status_geral: string
          status_logistica: string
          status_producao: string
          titulo: string
          updated_at: string
          valor_total: number
          valor_venda: number
          vendedor_id: string | null
        }
        Insert: {
          briefing?: string | null
          cliente_id: string
          contato_id?: string | null
          created_at?: string
          created_by?: string | null
          custo_previsto?: number
          custo_real?: number
          data_entrega_real?: string | null
          data_fechamento?: string | null
          desconto?: number
          designer_id?: string | null
          estoque_baixado?: boolean
          estoque_baixado_em?: string | null
          id?: string
          lucro_previsto?: number
          lucro_real?: number
          maquina_id?: string | null
          margem_prevista?: number | null
          margem_real?: number | null
          numero?: number
          numero_os?: number | null
          observacoes?: string | null
          operador_id?: string | null
          orcamento_id?: string | null
          ordem_kanban?: number
          prazo_cliente?: string | null
          prazo_entrega?: string | null
          prazo_interno?: string | null
          precisa_entrega?: boolean
          precisa_instalacao?: boolean
          prioridade?: number
          produto_id?: string | null
          responsavel_id?: string | null
          setor_atual?: string | null
          status?: Database["public"]["Enums"]["status_os"]
          status_arte?: string
          status_comercial?: string
          status_financeiro?: Database["public"]["Enums"]["status_pagamento"]
          status_geral?: string
          status_logistica?: string
          status_producao?: string
          titulo: string
          updated_at?: string
          valor_total?: number
          valor_venda?: number
          vendedor_id?: string | null
        }
        Update: {
          briefing?: string | null
          cliente_id?: string
          contato_id?: string | null
          created_at?: string
          created_by?: string | null
          custo_previsto?: number
          custo_real?: number
          data_entrega_real?: string | null
          data_fechamento?: string | null
          desconto?: number
          designer_id?: string | null
          estoque_baixado?: boolean
          estoque_baixado_em?: string | null
          id?: string
          lucro_previsto?: number
          lucro_real?: number
          maquina_id?: string | null
          margem_prevista?: number | null
          margem_real?: number | null
          numero?: number
          numero_os?: number | null
          observacoes?: string | null
          operador_id?: string | null
          orcamento_id?: string | null
          ordem_kanban?: number
          prazo_cliente?: string | null
          prazo_entrega?: string | null
          prazo_interno?: string | null
          precisa_entrega?: boolean
          precisa_instalacao?: boolean
          prioridade?: number
          produto_id?: string | null
          responsavel_id?: string | null
          setor_atual?: string | null
          status?: Database["public"]["Enums"]["status_os"]
          status_arte?: string
          status_comercial?: string
          status_financeiro?: Database["public"]["Enums"]["status_pagamento"]
          status_geral?: string
          status_logistica?: string
          status_producao?: string
          titulo?: string
          updated_at?: string
          valor_total?: number
          valor_venda?: number
          vendedor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ordens_servico_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "cliente_contatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_designer_id_fkey"
            columns: ["designer_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: false
            referencedRelation: "maquinas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: false
            referencedRelation: "rel_producao_por_maquina"
            referencedColumns: ["maquina_id"]
          },
          {
            foreignKeyName: "ordens_servico_operador_id_fkey"
            columns: ["operador_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      os_materiais_obrigatorios: {
        Row: {
          created_at: string
          id: string
          material_id: string
          os_id: string
          quantidade: number
        }
        Insert: {
          created_at?: string
          id?: string
          material_id: string
          os_id: string
          quantidade: number
        }
        Update: {
          created_at?: string
          id?: string
          material_id?: string
          os_id?: string
          quantidade?: number
        }
        Relationships: [
          {
            foreignKeyName: "os_materiais_obrigatorios_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_materiais_obrigatorios_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_materiais_obrigatorios_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_materiais_obrigatorios_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "vw_estoque_critico"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "os_materiais_obrigatorios_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_materiais_obrigatorios_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_materiais_obrigatorios_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_materiais_obrigatorios_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "os_materiais_obrigatorios_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "os_materiais_obrigatorios_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "os_materiais_obrigatorios_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
        ]
      }
      os_materiais_previstos: {
        Row: {
          created_at: string
          custo_unitario_previsto: number
          id: string
          material_id: string
          os_id: string
          os_item_id: string | null
          quantidade: number
          tarefa_id: string | null
          unidade: string
        }
        Insert: {
          created_at?: string
          custo_unitario_previsto?: number
          id?: string
          material_id: string
          os_id: string
          os_item_id?: string | null
          quantidade: number
          tarefa_id?: string | null
          unidade?: string
        }
        Update: {
          created_at?: string
          custo_unitario_previsto?: number
          id?: string
          material_id?: string
          os_id?: string
          os_item_id?: string | null
          quantidade?: number
          tarefa_id?: string | null
          unidade?: string
        }
        Relationships: [
          {
            foreignKeyName: "os_materiais_previstos_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_materiais_previstos_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_materiais_previstos_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_materiais_previstos_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "vw_estoque_critico"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "os_materiais_previstos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_materiais_previstos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_materiais_previstos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_materiais_previstos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "os_materiais_previstos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "os_materiais_previstos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "os_materiais_previstos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "os_materiais_previstos_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_materiais_previstos_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_materiais_previstos_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_materiais_previstos_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "os_tarefas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_materiais_previstos_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "vw_tarefas_kanban"
            referencedColumns: ["id"]
          },
        ]
      }
      os_resultado_snapshots: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          os_id: string
          resultado_json: Json
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          os_id: string
          resultado_json: Json
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          os_id?: string
          resultado_json?: Json
        }
        Relationships: [
          {
            foreignKeyName: "os_resultado_snapshots_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_resultado_snapshots_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_resultado_snapshots_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_resultado_snapshots_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_resultado_snapshots_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "os_resultado_snapshots_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "os_resultado_snapshots_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "os_resultado_snapshots_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
        ]
      }
      os_resultados: {
        Row: {
          created_at: string
          custo_previsto: number
          custo_real: number
          fechado_em: string
          fechado_por: string | null
          id: string
          lucro_previsto: number
          lucro_real: number
          margem_prevista: number | null
          margem_real: number | null
          material_consumido: number
          material_previsto: number | null
          motivo_divergencia: string | null
          os_id: string
          tempo_previsto: number | null
          tempo_real: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          custo_previsto?: number
          custo_real?: number
          fechado_em?: string
          fechado_por?: string | null
          id?: string
          lucro_previsto?: number
          lucro_real?: number
          margem_prevista?: number | null
          margem_real?: number | null
          material_consumido?: number
          material_previsto?: number | null
          motivo_divergencia?: string | null
          os_id: string
          tempo_previsto?: number | null
          tempo_real?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          custo_previsto?: number
          custo_real?: number
          fechado_em?: string
          fechado_por?: string | null
          id?: string
          lucro_previsto?: number
          lucro_real?: number
          margem_prevista?: number | null
          margem_real?: number | null
          material_consumido?: number
          material_previsto?: number | null
          motivo_divergencia?: string | null
          os_id?: string
          tempo_previsto?: number | null
          tempo_real?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "os_resultados_fechado_por_fkey"
            columns: ["fechado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_resultados_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: true
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_resultados_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: true
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_resultados_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: true
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_resultados_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: true
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "os_resultados_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: true
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "os_resultados_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: true
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "os_resultados_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: true
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
        ]
      }
      os_resultados_financeiros: {
        Row: {
          custo_previsto: number
          custo_real: number
          margem_real: number | null
          os_id: string
          updated_at: string
          valor_total: number
        }
        Insert: {
          custo_previsto?: number
          custo_real?: number
          margem_real?: number | null
          os_id: string
          updated_at?: string
          valor_total?: number
        }
        Update: {
          custo_previsto?: number
          custo_real?: number
          margem_real?: number | null
          os_id?: string
          updated_at?: string
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "os_resultados_financeiros_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: true
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_resultados_financeiros_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: true
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_resultados_financeiros_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: true
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_resultados_financeiros_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: true
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "os_resultados_financeiros_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: true
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "os_resultados_financeiros_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: true
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "os_resultados_financeiros_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: true
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
        ]
      }
      os_tarefa_comentarios: {
        Row: {
          anexos: Json
          autor_id: string | null
          comentario: string
          created_at: string
          id: string
          tarefa_id: string
        }
        Insert: {
          anexos?: Json
          autor_id?: string | null
          comentario: string
          created_at?: string
          id?: string
          tarefa_id: string
        }
        Update: {
          anexos?: Json
          autor_id?: string | null
          comentario?: string
          created_at?: string
          id?: string
          tarefa_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "os_tarefa_comentarios_autor_id_fkey"
            columns: ["autor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_tarefa_comentarios_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "os_tarefas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_tarefa_comentarios_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "vw_tarefas_kanban"
            referencedColumns: ["id"]
          },
        ]
      }
      os_tarefas: {
        Row: {
          anexos: Json
          bloqueia_dependentes: boolean
          checklist: Json
          comentarios: Json
          completed_by: string | null
          created_at: string
          created_by: string | null
          dependencias: Json
          descricao: string | null
          fim_previsto: string | null
          fim_real: string | null
          id: string
          inicio_previsto: string | null
          inicio_real: string | null
          minutos_previstos: number
          minutos_realizados: number
          obrigatoria: boolean
          os_id: string
          os_item_id: string | null
          prazo: string | null
          prioridade: string
          responsavel_id: string | null
          setor: string | null
          status: string
          titulo: string
          updated_at: string
        }
        Insert: {
          anexos?: Json
          bloqueia_dependentes?: boolean
          checklist?: Json
          comentarios?: Json
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          dependencias?: Json
          descricao?: string | null
          fim_previsto?: string | null
          fim_real?: string | null
          id?: string
          inicio_previsto?: string | null
          inicio_real?: string | null
          minutos_previstos?: number
          minutos_realizados?: number
          obrigatoria?: boolean
          os_id: string
          os_item_id?: string | null
          prazo?: string | null
          prioridade?: string
          responsavel_id?: string | null
          setor?: string | null
          status?: string
          titulo: string
          updated_at?: string
        }
        Update: {
          anexos?: Json
          bloqueia_dependentes?: boolean
          checklist?: Json
          comentarios?: Json
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          dependencias?: Json
          descricao?: string | null
          fim_previsto?: string | null
          fim_real?: string | null
          id?: string
          inicio_previsto?: string | null
          inicio_real?: string | null
          minutos_previstos?: number
          minutos_realizados?: number
          obrigatoria?: boolean
          os_id?: string
          os_item_id?: string | null
          prazo?: string | null
          prioridade?: string
          responsavel_id?: string | null
          setor?: string | null
          status?: string
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "os_tarefas_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_tarefas_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_tarefas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_tarefas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_tarefas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_tarefas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "os_tarefas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "os_tarefas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "os_tarefas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "os_tarefas_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_tarefas_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_tarefas_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_tarefas_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      pagamentos: {
        Row: {
          comprovante_url: string | null
          created_at: string
          data_pagamento: string | null
          data_vencimento: string | null
          forma_pagamento: string | null
          id: string
          observacoes: string | null
          os_id: string
          pagamento_estornado_id: string | null
          parcela: number
          parcela_id: string | null
          referencia_externa: string | null
          registrado_por: string | null
          status: Database["public"]["Enums"]["status_pagamento"]
          taxa: number
          total_parcelas: number
          updated_at: string
          valor: number
        }
        Insert: {
          comprovante_url?: string | null
          created_at?: string
          data_pagamento?: string | null
          data_vencimento?: string | null
          forma_pagamento?: string | null
          id?: string
          observacoes?: string | null
          os_id: string
          pagamento_estornado_id?: string | null
          parcela?: number
          parcela_id?: string | null
          referencia_externa?: string | null
          registrado_por?: string | null
          status?: Database["public"]["Enums"]["status_pagamento"]
          taxa?: number
          total_parcelas?: number
          updated_at?: string
          valor: number
        }
        Update: {
          comprovante_url?: string | null
          created_at?: string
          data_pagamento?: string | null
          data_vencimento?: string | null
          forma_pagamento?: string | null
          id?: string
          observacoes?: string | null
          os_id?: string
          pagamento_estornado_id?: string | null
          parcela?: number
          parcela_id?: string | null
          referencia_externa?: string | null
          registrado_por?: string | null
          status?: Database["public"]["Enums"]["status_pagamento"]
          taxa?: number
          total_parcelas?: number
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "pagamentos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagamentos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagamentos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagamentos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "pagamentos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "pagamentos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "pagamentos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "pagamentos_pagamento_estornado_id_fkey"
            columns: ["pagamento_estornado_id"]
            isOneToOne: false
            referencedRelation: "pagamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagamentos_parcela_id_fkey"
            columns: ["parcela_id"]
            isOneToOne: false
            referencedRelation: "parcelas_receber"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagamentos_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      parcelas_receber: {
        Row: {
          conta_id: string
          created_at: string
          id: string
          parcela: number
          status: string
          valor: number
          vencimento: string | null
        }
        Insert: {
          conta_id: string
          created_at?: string
          id?: string
          parcela: number
          status?: string
          valor: number
          vencimento?: string | null
        }
        Update: {
          conta_id?: string
          created_at?: string
          id?: string
          parcela?: number
          status?: string
          valor?: number
          vencimento?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parcelas_receber_conta_id_fkey"
            columns: ["conta_id"]
            isOneToOne: false
            referencedRelation: "contas_receber"
            referencedColumns: ["id"]
          },
        ]
      }
      perfil_permissoes: {
        Row: {
          created_at: string
          perfil: string
          permissao: string
        }
        Insert: {
          created_at?: string
          perfil: string
          permissao: string
        }
        Update: {
          created_at?: string
          perfil?: string
          permissao?: string
        }
        Relationships: [
          {
            foreignKeyName: "perfil_permissoes_permissao_fkey"
            columns: ["permissao"]
            isOneToOne: false
            referencedRelation: "permissoes"
            referencedColumns: ["chave"]
          },
        ]
      }
      permissoes: {
        Row: {
          chave: string
          created_at: string
          descricao: string
          dominio: string
        }
        Insert: {
          chave: string
          created_at?: string
          descricao: string
          dominio: string
        }
        Update: {
          chave?: string
          created_at?: string
          descricao?: string
          dominio?: string
        }
        Relationships: []
      }
      portal_cliente_acessos: {
        Row: {
          ativo: boolean
          cliente_id: string
          created_at: string
          id: string
          usuario_id: string | null
        }
        Insert: {
          ativo?: boolean
          cliente_id: string
          created_at?: string
          id?: string
          usuario_id?: string | null
        }
        Update: {
          ativo?: boolean
          cliente_id?: string
          created_at?: string
          id?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_cliente_acessos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_cliente_acessos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_cliente_solicitacoes: {
        Row: {
          cliente_id: string
          created_at: string
          id: string
          mensagem: string
          orcamento_id: string | null
          os_id: string | null
          status: string
          tipo: string
        }
        Insert: {
          cliente_id: string
          created_at?: string
          id?: string
          mensagem: string
          orcamento_id?: string | null
          os_id?: string | null
          status?: string
          tipo: string
        }
        Update: {
          cliente_id?: string
          created_at?: string
          id?: string
          mensagem?: string
          orcamento_id?: string | null
          os_id?: string | null
          status?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_cliente_solicitacoes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_cliente_solicitacoes_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_cliente_solicitacoes_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_cliente_solicitacoes_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_cliente_solicitacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_cliente_solicitacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_cliente_solicitacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_cliente_solicitacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "portal_cliente_solicitacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "portal_cliente_solicitacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "portal_cliente_solicitacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
        ]
      }
      pos_venda_garantias: {
        Row: {
          cliente_id: string | null
          created_at: string
          custo_previsto: number
          custo_real: number
          id: string
          os_id: string | null
          status: string
          ticket_id: string | null
        }
        Insert: {
          cliente_id?: string | null
          created_at?: string
          custo_previsto?: number
          custo_real?: number
          id?: string
          os_id?: string | null
          status?: string
          ticket_id?: string | null
        }
        Update: {
          cliente_id?: string | null
          created_at?: string
          custo_previsto?: number
          custo_real?: number
          id?: string
          os_id?: string | null
          status?: string
          ticket_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_venda_garantias_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_venda_garantias_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_venda_garantias_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_venda_garantias_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_venda_garantias_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "pos_venda_garantias_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "pos_venda_garantias_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "pos_venda_garantias_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "pos_venda_garantias_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "pos_venda_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_venda_oportunidades: {
        Row: {
          cliente_id: string | null
          created_at: string
          descricao: string | null
          id: string
          os_origem_id: string | null
          status: string
          valor_estimado: number | null
        }
        Insert: {
          cliente_id?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          os_origem_id?: string | null
          status?: string
          valor_estimado?: number | null
        }
        Update: {
          cliente_id?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          os_origem_id?: string | null
          status?: string
          valor_estimado?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_venda_oportunidades_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_venda_oportunidades_os_origem_id_fkey"
            columns: ["os_origem_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_venda_oportunidades_os_origem_id_fkey"
            columns: ["os_origem_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_venda_oportunidades_os_origem_id_fkey"
            columns: ["os_origem_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_venda_oportunidades_os_origem_id_fkey"
            columns: ["os_origem_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "pos_venda_oportunidades_os_origem_id_fkey"
            columns: ["os_origem_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "pos_venda_oportunidades_os_origem_id_fkey"
            columns: ["os_origem_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "pos_venda_oportunidades_os_origem_id_fkey"
            columns: ["os_origem_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
        ]
      }
      pos_venda_pesquisas: {
        Row: {
          agendada_para: string
          cliente_id: string | null
          created_at: string
          enviada_em: string | null
          id: string
          os_id: string | null
          status: string
          tipo: string
        }
        Insert: {
          agendada_para?: string
          cliente_id?: string | null
          created_at?: string
          enviada_em?: string | null
          id?: string
          os_id?: string | null
          status?: string
          tipo?: string
        }
        Update: {
          agendada_para?: string
          cliente_id?: string | null
          created_at?: string
          enviada_em?: string | null
          id?: string
          os_id?: string | null
          status?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_venda_pesquisas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_venda_pesquisas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_venda_pesquisas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_venda_pesquisas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_venda_pesquisas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "pos_venda_pesquisas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "pos_venda_pesquisas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "pos_venda_pesquisas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
        ]
      }
      pos_venda_respostas: {
        Row: {
          cliente_id: string | null
          comentario: string | null
          created_at: string
          id: string
          nota: number | null
          nps_classificacao: string | null
          pesquisa_id: string | null
        }
        Insert: {
          cliente_id?: string | null
          comentario?: string | null
          created_at?: string
          id?: string
          nota?: number | null
          nps_classificacao?: string | null
          pesquisa_id?: string | null
        }
        Update: {
          cliente_id?: string | null
          comentario?: string | null
          created_at?: string
          id?: string
          nota?: number | null
          nps_classificacao?: string | null
          pesquisa_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_venda_respostas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_venda_respostas_pesquisa_id_fkey"
            columns: ["pesquisa_id"]
            isOneToOne: false
            referencedRelation: "pos_venda_pesquisas"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_venda_retornos: {
        Row: {
          cliente_id: string | null
          created_at: string
          id: string
          motivo: string | null
          os_id: string | null
          status: string
        }
        Insert: {
          cliente_id?: string | null
          created_at?: string
          id?: string
          motivo?: string | null
          os_id?: string | null
          status?: string
        }
        Update: {
          cliente_id?: string | null
          created_at?: string
          id?: string
          motivo?: string | null
          os_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_venda_retornos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_venda_retornos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_venda_retornos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_venda_retornos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_venda_retornos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "pos_venda_retornos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "pos_venda_retornos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "pos_venda_retornos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
        ]
      }
      pos_venda_tickets: {
        Row: {
          cliente_id: string | null
          created_at: string
          descricao: string
          id: string
          os_id: string | null
          prazo_resolucao: string | null
          prioridade: string
          resolvido_em: string | null
          status: string
          tipo: string
        }
        Insert: {
          cliente_id?: string | null
          created_at?: string
          descricao: string
          id?: string
          os_id?: string | null
          prazo_resolucao?: string | null
          prioridade?: string
          resolvido_em?: string | null
          status?: string
          tipo?: string
        }
        Update: {
          cliente_id?: string | null
          created_at?: string
          descricao?: string
          id?: string
          os_id?: string | null
          prazo_resolucao?: string | null
          prioridade?: string
          resolvido_em?: string | null
          status?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_venda_tickets_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_venda_tickets_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_venda_tickets_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_venda_tickets_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_venda_tickets_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "pos_venda_tickets_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "pos_venda_tickets_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "pos_venda_tickets_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
        ]
      }
      producao_3d_apontamentos: {
        Row: {
          apontamento_id: string | null
          arquivo_log_id: string | null
          consumo_real_json: Json
          created_at: string
          energia_real_kwh: number | null
          fim: string | null
          id: string
          inicio: string
          job_id: string
          observacao: string | null
          ocorrencia_id: string | null
          operador_id: string | null
          pausas: Json
          percentual_consumido_antes_falha: number | null
          resultado: string
          tempo_real_segundos: number | null
        }
        Insert: {
          apontamento_id?: string | null
          arquivo_log_id?: string | null
          consumo_real_json?: Json
          created_at?: string
          energia_real_kwh?: number | null
          fim?: string | null
          id?: string
          inicio?: string
          job_id: string
          observacao?: string | null
          ocorrencia_id?: string | null
          operador_id?: string | null
          pausas?: Json
          percentual_consumido_antes_falha?: number | null
          resultado?: string
          tempo_real_segundos?: number | null
        }
        Update: {
          apontamento_id?: string | null
          arquivo_log_id?: string | null
          consumo_real_json?: Json
          created_at?: string
          energia_real_kwh?: number | null
          fim?: string | null
          id?: string
          inicio?: string
          job_id?: string
          observacao?: string | null
          ocorrencia_id?: string | null
          operador_id?: string | null
          pausas?: Json
          percentual_consumido_antes_falha?: number | null
          resultado?: string
          tempo_real_segundos?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "producao_3d_apontamentos_apontamento_id_fkey"
            columns: ["apontamento_id"]
            isOneToOne: false
            referencedRelation: "apontamentos_producao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producao_3d_apontamentos_arquivo_log_id_fkey"
            columns: ["arquivo_log_id"]
            isOneToOne: false
            referencedRelation: "arquivos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producao_3d_apontamentos_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "producao_3d_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producao_3d_apontamentos_ocorrencia_id_fkey"
            columns: ["ocorrencia_id"]
            isOneToOne: false
            referencedRelation: "ocorrencias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producao_3d_apontamentos_operador_id_fkey"
            columns: ["operador_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      producao_3d_fechamentos: {
        Row: {
          causa_diferenca: string | null
          closed_at: string
          closed_by: string | null
          custo_previsto: number
          custo_real: number
          falhas: number
          id: string
          lucro_previsto: number
          lucro_real: number
          margem_prevista: number | null
          margem_real: number | null
          material_previsto_g: number
          material_real_g: number
          os_id: string
          os_item_id: string | null
          purga_prevista_g: number
          purga_real_g: number
          reimpressoes: number
          tempo_previsto_segundos: number
          tempo_real_segundos: number
        }
        Insert: {
          causa_diferenca?: string | null
          closed_at?: string
          closed_by?: string | null
          custo_previsto?: number
          custo_real?: number
          falhas?: number
          id?: string
          lucro_previsto?: number
          lucro_real?: number
          margem_prevista?: number | null
          margem_real?: number | null
          material_previsto_g?: number
          material_real_g?: number
          os_id: string
          os_item_id?: string | null
          purga_prevista_g?: number
          purga_real_g?: number
          reimpressoes?: number
          tempo_previsto_segundos?: number
          tempo_real_segundos?: number
        }
        Update: {
          causa_diferenca?: string | null
          closed_at?: string
          closed_by?: string | null
          custo_previsto?: number
          custo_real?: number
          falhas?: number
          id?: string
          lucro_previsto?: number
          lucro_real?: number
          margem_prevista?: number | null
          margem_real?: number | null
          material_previsto_g?: number
          material_real_g?: number
          os_id?: string
          os_item_id?: string | null
          purga_prevista_g?: number
          purga_real_g?: number
          reimpressoes?: number
          tempo_previsto_segundos?: number
          tempo_real_segundos?: number
        }
        Relationships: [
          {
            foreignKeyName: "producao_3d_fechamentos_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producao_3d_fechamentos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producao_3d_fechamentos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producao_3d_fechamentos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producao_3d_fechamentos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "producao_3d_fechamentos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "producao_3d_fechamentos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "producao_3d_fechamentos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "producao_3d_fechamentos_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producao_3d_fechamentos_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producao_3d_fechamentos_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os_operacional"
            referencedColumns: ["id"]
          },
        ]
      }
      producao_3d_jobs: {
        Row: {
          agenda_id: string | null
          created_at: string
          custo_previsto_snapshot: Json
          custo_real_snapshot: Json
          id: string
          maquina_id: string | null
          orcamento_3d_id: string | null
          os_id: string
          os_item_id: string | null
          placa_id: string | null
          repeticao: number
          status: string
        }
        Insert: {
          agenda_id?: string | null
          created_at?: string
          custo_previsto_snapshot?: Json
          custo_real_snapshot?: Json
          id?: string
          maquina_id?: string | null
          orcamento_3d_id?: string | null
          os_id: string
          os_item_id?: string | null
          placa_id?: string | null
          repeticao?: number
          status?: string
        }
        Update: {
          agenda_id?: string | null
          created_at?: string
          custo_previsto_snapshot?: Json
          custo_real_snapshot?: Json
          id?: string
          maquina_id?: string | null
          orcamento_3d_id?: string | null
          os_id?: string
          os_item_id?: string | null
          placa_id?: string | null
          repeticao?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "producao_3d_jobs_agenda_id_fkey"
            columns: ["agenda_id"]
            isOneToOne: false
            referencedRelation: "maquinas_agenda"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producao_3d_jobs_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: false
            referencedRelation: "maquinas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producao_3d_jobs_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: false
            referencedRelation: "rel_producao_por_maquina"
            referencedColumns: ["maquina_id"]
          },
          {
            foreignKeyName: "producao_3d_jobs_orcamento_3d_id_fkey"
            columns: ["orcamento_3d_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_3d"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producao_3d_jobs_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producao_3d_jobs_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producao_3d_jobs_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producao_3d_jobs_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "producao_3d_jobs_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "producao_3d_jobs_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "producao_3d_jobs_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "producao_3d_jobs_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producao_3d_jobs_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producao_3d_jobs_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producao_3d_jobs_placa_id_fkey"
            columns: ["placa_id"]
            isOneToOne: false
            referencedRelation: "orcamento_3d_placas"
            referencedColumns: ["id"]
          },
        ]
      }
      produto_materiais: {
        Row: {
          created_at: string
          id: string
          material_id: string
          observacao: string | null
          produto_id: string
          quantidade_por_unidade: number
        }
        Insert: {
          created_at?: string
          id?: string
          material_id: string
          observacao?: string | null
          produto_id: string
          quantidade_por_unidade?: number
        }
        Update: {
          created_at?: string
          id?: string
          material_id?: string
          observacao?: string | null
          produto_id?: string
          quantidade_por_unidade?: number
        }
        Relationships: [
          {
            foreignKeyName: "produto_materiais_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produto_materiais_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produto_materiais_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produto_materiais_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "vw_estoque_critico"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "produto_materiais_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produto_materiais_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos_operacional"
            referencedColumns: ["id"]
          },
        ]
      }
      produto_precificacao: {
        Row: {
          ativo: boolean
          created_at: string
          custo_indireto: number
          custo_mao_obra: number
          custo_maquina: number
          custo_material: number
          id: string
          maquina_id: string | null
          margem_percentual: number
          material_id: string | null
          nome: string
          preco_calculado: number
          produto_id: string
          quantidade_base: number
          unidade: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          custo_indireto?: number
          custo_mao_obra?: number
          custo_maquina?: number
          custo_material?: number
          id?: string
          maquina_id?: string | null
          margem_percentual?: number
          material_id?: string | null
          nome: string
          preco_calculado?: number
          produto_id: string
          quantidade_base?: number
          unidade?: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          custo_indireto?: number
          custo_mao_obra?: number
          custo_maquina?: number
          custo_material?: number
          id?: string
          maquina_id?: string | null
          margem_percentual?: number
          material_id?: string | null
          nome?: string
          preco_calculado?: number
          produto_id?: string
          quantidade_base?: number
          unidade?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "produto_precificacao_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: false
            referencedRelation: "maquinas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produto_precificacao_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: false
            referencedRelation: "rel_producao_por_maquina"
            referencedColumns: ["maquina_id"]
          },
          {
            foreignKeyName: "produto_precificacao_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produto_precificacao_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produto_precificacao_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produto_precificacao_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "vw_estoque_critico"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "produto_precificacao_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produto_precificacao_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos_operacional"
            referencedColumns: ["id"]
          },
        ]
      }
      produtos: {
        Row: {
          ativo: boolean
          categoria: Database["public"]["Enums"]["categoria_produto"]
          created_at: string
          custo_medio: number
          descricao: string | null
          exigencias: string | null
          id: string
          imagem_url: string | null
          maquina_padrao_id: string | null
          margem_minima: number
          margem_sugerida: number | null
          material_principal_id: string | null
          nome: string
          observacoes_internas: string | null
          preco_base: number | null
          preco_minimo: number | null
          preco_publico: number | null
          preco_sugerido: number | null
          sku: string | null
          sugestoes_operacionais: Json
          tempo_producao_min: number | null
          tipo: Database["public"]["Enums"]["tipo_item"]
          unidade: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          categoria?: Database["public"]["Enums"]["categoria_produto"]
          created_at?: string
          custo_medio?: number
          descricao?: string | null
          exigencias?: string | null
          id?: string
          imagem_url?: string | null
          maquina_padrao_id?: string | null
          margem_minima?: number
          margem_sugerida?: number | null
          material_principal_id?: string | null
          nome: string
          observacoes_internas?: string | null
          preco_base?: number | null
          preco_minimo?: number | null
          preco_publico?: number | null
          preco_sugerido?: number | null
          sku?: string | null
          sugestoes_operacionais?: Json
          tempo_producao_min?: number | null
          tipo?: Database["public"]["Enums"]["tipo_item"]
          unidade?: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          categoria?: Database["public"]["Enums"]["categoria_produto"]
          created_at?: string
          custo_medio?: number
          descricao?: string | null
          exigencias?: string | null
          id?: string
          imagem_url?: string | null
          maquina_padrao_id?: string | null
          margem_minima?: number
          margem_sugerida?: number | null
          material_principal_id?: string | null
          nome?: string
          observacoes_internas?: string | null
          preco_base?: number | null
          preco_minimo?: number | null
          preco_publico?: number | null
          preco_sugerido?: number | null
          sku?: string | null
          sugestoes_operacionais?: Json
          tempo_producao_min?: number | null
          tipo?: Database["public"]["Enums"]["tipo_item"]
          unidade?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "produtos_maquina_padrao_id_fkey"
            columns: ["maquina_padrao_id"]
            isOneToOne: false
            referencedRelation: "maquinas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produtos_maquina_padrao_id_fkey"
            columns: ["maquina_padrao_id"]
            isOneToOne: false
            referencedRelation: "rel_producao_por_maquina"
            referencedColumns: ["maquina_id"]
          },
          {
            foreignKeyName: "produtos_material_principal_id_fkey"
            columns: ["material_principal_id"]
            isOneToOne: false
            referencedRelation: "materiais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produtos_material_principal_id_fkey"
            columns: ["material_principal_id"]
            isOneToOne: false
            referencedRelation: "materiais_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produtos_material_principal_id_fkey"
            columns: ["material_principal_id"]
            isOneToOne: false
            referencedRelation: "materiais_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produtos_material_principal_id_fkey"
            columns: ["material_principal_id"]
            isOneToOne: false
            referencedRelation: "vw_estoque_critico"
            referencedColumns: ["material_id"]
          },
        ]
      }
      qualidade_checklists: {
        Row: {
          ativo: boolean
          categoria: string | null
          created_at: string
          id: string
          itens: Json
          operacao: string | null
          produto_id: string | null
        }
        Insert: {
          ativo?: boolean
          categoria?: string | null
          created_at?: string
          id?: string
          itens?: Json
          operacao?: string | null
          produto_id?: string | null
        }
        Update: {
          ativo?: boolean
          categoria?: string | null
          created_at?: string
          id?: string
          itens?: Json
          operacao?: string | null
          produto_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qualidade_checklists_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qualidade_checklists_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos_operacional"
            referencedColumns: ["id"]
          },
        ]
      }
      qualidade_inspecoes: {
        Row: {
          checklist_id: string | null
          created_at: string
          data: string
          fotos: Json
          id: string
          observacao: string | null
          os_id: string
          os_item_id: string | null
          responsavel_id: string | null
          respostas: Json
          resultado: string
          tarefa_id: string | null
        }
        Insert: {
          checklist_id?: string | null
          created_at?: string
          data?: string
          fotos?: Json
          id?: string
          observacao?: string | null
          os_id: string
          os_item_id?: string | null
          responsavel_id?: string | null
          respostas?: Json
          resultado: string
          tarefa_id?: string | null
        }
        Update: {
          checklist_id?: string | null
          created_at?: string
          data?: string
          fotos?: Json
          id?: string
          observacao?: string | null
          os_id?: string
          os_item_id?: string | null
          responsavel_id?: string | null
          respostas?: Json
          resultado?: string
          tarefa_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qualidade_inspecoes_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "qualidade_checklists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qualidade_inspecoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qualidade_inspecoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qualidade_inspecoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qualidade_inspecoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "qualidade_inspecoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "qualidade_inspecoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "qualidade_inspecoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "qualidade_inspecoes_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qualidade_inspecoes_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qualidade_inspecoes_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qualidade_inspecoes_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qualidade_inspecoes_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "os_tarefas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qualidade_inspecoes_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "vw_tarefas_kanban"
            referencedColumns: ["id"]
          },
        ]
      }
      relatorios: {
        Row: {
          created_at: string
          descricao: string | null
          gerado_em: string | null
          grupo: string
          id: string
          nome: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          descricao?: string | null
          gerado_em?: string | null
          grupo: string
          id?: string
          nome: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          descricao?: string | null
          gerado_em?: string | null
          grupo?: string
          id?: string
          nome?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      respostas_rapidas: {
        Row: {
          ativo: boolean
          categoria: string
          created_at: string
          id: string
          texto: string
          titulo: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          categoria?: string
          created_at?: string
          id?: string
          texto: string
          titulo: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          categoria?: string
          created_at?: string
          id?: string
          texto?: string
          titulo?: string
          updated_at?: string
        }
        Relationships: []
      }
      slicer_imports: {
        Row: {
          arquivo_id: string | null
          campos_ausentes: string[]
          campos_encontrados: string[]
          correcoes_manuais: Json
          corrigido_por: string | null
          created_at: string
          created_by: string | null
          extensao: string
          id: string
          mime: string | null
          nome_arquivo: string
          normalized_json: Json
          orcamento_3d_id: string | null
          parser: string
          raw_json: Json
          sha256: string
          tamanho: number
        }
        Insert: {
          arquivo_id?: string | null
          campos_ausentes?: string[]
          campos_encontrados?: string[]
          correcoes_manuais?: Json
          corrigido_por?: string | null
          created_at?: string
          created_by?: string | null
          extensao: string
          id?: string
          mime?: string | null
          nome_arquivo: string
          normalized_json?: Json
          orcamento_3d_id?: string | null
          parser: string
          raw_json?: Json
          sha256: string
          tamanho: number
        }
        Update: {
          arquivo_id?: string | null
          campos_ausentes?: string[]
          campos_encontrados?: string[]
          correcoes_manuais?: Json
          corrigido_por?: string | null
          created_at?: string
          created_by?: string | null
          extensao?: string
          id?: string
          mime?: string | null
          nome_arquivo?: string
          normalized_json?: Json
          orcamento_3d_id?: string | null
          parser?: string
          raw_json?: Json
          sha256?: string
          tamanho?: number
        }
        Relationships: [
          {
            foreignKeyName: "slicer_imports_arquivo_id_fkey"
            columns: ["arquivo_id"]
            isOneToOne: false
            referencedRelation: "arquivos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slicer_imports_corrigido_por_fkey"
            columns: ["corrigido_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slicer_imports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slicer_imports_orcamento_3d_id_fkey"
            columns: ["orcamento_3d_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_3d"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      usuarios: {
        Row: {
          ativo: boolean
          avatar_url: string | null
          created_at: string
          email: string
          id: string
          nome: string
          telefone: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          avatar_url?: string | null
          created_at?: string
          email: string
          id: string
          nome: string
          telefone?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          avatar_url?: string | null
          created_at?: string
          email?: string
          id?: string
          nome?: string
          telefone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_anexos: {
        Row: {
          bucket: string
          caminho: string
          created_at: string
          id: string
          mensagem_id: string | null
          mime_type: string | null
          tamanho_bytes: number | null
        }
        Insert: {
          bucket?: string
          caminho: string
          created_at?: string
          id?: string
          mensagem_id?: string | null
          mime_type?: string | null
          tamanho_bytes?: number | null
        }
        Update: {
          bucket?: string
          caminho?: string
          created_at?: string
          id?: string
          mensagem_id?: string | null
          mime_type?: string | null
          tamanho_bytes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_anexos_mensagem_id_fkey"
            columns: ["mensagem_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_mensagens"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_contatos: {
        Row: {
          cliente_id: string | null
          created_at: string
          id: string
          lead_id: string | null
          nome: string | null
          telefone_normalizado: string
          telefone_original: string | null
          updated_at: string
        }
        Insert: {
          cliente_id?: string | null
          created_at?: string
          id?: string
          lead_id?: string | null
          nome?: string | null
          telefone_normalizado: string
          telefone_original?: string | null
          updated_at?: string
        }
        Update: {
          cliente_id?: string | null
          created_at?: string
          id?: string
          lead_id?: string | null
          nome?: string | null
          telefone_normalizado?: string
          telefone_original?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_contatos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_contatos_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_conversas: {
        Row: {
          atribuido_para: string | null
          cliente_id: string | null
          created_at: string
          etiquetas: string[]
          id: string
          instancia_id: string
          lead_id: string | null
          metadados: Json
          nao_lidas: number
          nome_contato: string | null
          os_id: string | null
          responsavel_id: string | null
          status: Database["public"]["Enums"]["whatsapp_conversa_status"]
          telefone: string
          telefone_normalizado: string | null
          ultima_mensagem: string | null
          ultima_mensagem_at: string | null
          unread_count: number
          updated_at: string
        }
        Insert: {
          atribuido_para?: string | null
          cliente_id?: string | null
          created_at?: string
          etiquetas?: string[]
          id?: string
          instancia_id: string
          lead_id?: string | null
          metadados?: Json
          nao_lidas?: number
          nome_contato?: string | null
          os_id?: string | null
          responsavel_id?: string | null
          status?: Database["public"]["Enums"]["whatsapp_conversa_status"]
          telefone: string
          telefone_normalizado?: string | null
          ultima_mensagem?: string | null
          ultima_mensagem_at?: string | null
          unread_count?: number
          updated_at?: string
        }
        Update: {
          atribuido_para?: string | null
          cliente_id?: string | null
          created_at?: string
          etiquetas?: string[]
          id?: string
          instancia_id?: string
          lead_id?: string | null
          metadados?: Json
          nao_lidas?: number
          nome_contato?: string | null
          os_id?: string | null
          responsavel_id?: string | null
          status?: Database["public"]["Enums"]["whatsapp_conversa_status"]
          telefone?: string
          telefone_normalizado?: string | null
          ultima_mensagem?: string | null
          ultima_mensagem_at?: string | null
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_conversas_atribuido_para_fkey"
            columns: ["atribuido_para"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversas_instancia_id_fkey"
            columns: ["instancia_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instancias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversas_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "whatsapp_conversas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "whatsapp_conversas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "whatsapp_conversas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "whatsapp_conversas_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_fila_envio: {
        Row: {
          conversa_id: string | null
          created_at: string
          created_by: string | null
          erro: string | null
          id: string
          idempotency_key: string
          mensagem_id: string | null
          payload: Json
          status: string
          tentativas: number
          updated_at: string
        }
        Insert: {
          conversa_id?: string | null
          created_at?: string
          created_by?: string | null
          erro?: string | null
          id?: string
          idempotency_key: string
          mensagem_id?: string | null
          payload: Json
          status?: string
          tentativas?: number
          updated_at?: string
        }
        Update: {
          conversa_id?: string | null
          created_at?: string
          created_by?: string | null
          erro?: string | null
          id?: string
          idempotency_key?: string
          mensagem_id?: string | null
          payload?: Json
          status?: string
          tentativas?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_fila_envio_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_fila_envio_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_fila_envio_mensagem_id_fkey"
            columns: ["mensagem_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_mensagens"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_instancias: {
        Row: {
          ativa: boolean
          conectado: boolean
          created_at: string
          id: string
          metadados: Json
          nome: string
          numero: string | null
          numero_normalizado: string | null
          status: Database["public"]["Enums"]["whatsapp_instancia_status"]
          ultimo_evento_at: string | null
          updated_at: string
          webhook_secret_hash: string | null
          zapi_instance_id: string
        }
        Insert: {
          ativa?: boolean
          conectado?: boolean
          created_at?: string
          id?: string
          metadados?: Json
          nome: string
          numero?: string | null
          numero_normalizado?: string | null
          status?: Database["public"]["Enums"]["whatsapp_instancia_status"]
          ultimo_evento_at?: string | null
          updated_at?: string
          webhook_secret_hash?: string | null
          zapi_instance_id: string
        }
        Update: {
          ativa?: boolean
          conectado?: boolean
          created_at?: string
          id?: string
          metadados?: Json
          nome?: string
          numero?: string | null
          numero_normalizado?: string | null
          status?: Database["public"]["Enums"]["whatsapp_instancia_status"]
          ultimo_evento_at?: string | null
          updated_at?: string
          webhook_secret_hash?: string | null
          zapi_instance_id?: string
        }
        Relationships: []
      }
      whatsapp_logs: {
        Row: {
          conversa_id: string | null
          created_at: string
          erro: string | null
          id: string
          instancia_id: string | null
          mensagem_id: string | null
          request: Json | null
          response: Json | null
          sucesso: boolean
          tipo: Database["public"]["Enums"]["whatsapp_log_tipo"]
        }
        Insert: {
          conversa_id?: string | null
          created_at?: string
          erro?: string | null
          id?: string
          instancia_id?: string | null
          mensagem_id?: string | null
          request?: Json | null
          response?: Json | null
          sucesso?: boolean
          tipo: Database["public"]["Enums"]["whatsapp_log_tipo"]
        }
        Update: {
          conversa_id?: string | null
          created_at?: string
          erro?: string | null
          id?: string
          instancia_id?: string | null
          mensagem_id?: string | null
          request?: Json | null
          response?: Json | null
          sucesso?: boolean
          tipo?: Database["public"]["Enums"]["whatsapp_log_tipo"]
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_logs_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_logs_instancia_id_fkey"
            columns: ["instancia_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instancias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_logs_mensagem_id_fkey"
            columns: ["mensagem_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_mensagens"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_mensagens: {
        Row: {
          arquivo_id: string | null
          cliente_id: string | null
          conversa_id: string
          created_at: string
          direcao: Database["public"]["Enums"]["whatsapp_mensagem_direcao"]
          entregue_em: string | null
          enviada_por: string | null
          enviado_em: string | null
          erro: string | null
          id: string
          instancia_id: string
          legenda: string | null
          lido_em: string | null
          media_url: string | null
          os_id: string | null
          payload: Json
          recebido_em: string | null
          status: Database["public"]["Enums"]["whatsapp_mensagem_status"]
          storage_bucket: string | null
          storage_path: string | null
          texto: string | null
          tipo: Database["public"]["Enums"]["whatsapp_mensagem_tipo"]
          updated_at: string
          zapi_message_id: string | null
        }
        Insert: {
          arquivo_id?: string | null
          cliente_id?: string | null
          conversa_id: string
          created_at?: string
          direcao: Database["public"]["Enums"]["whatsapp_mensagem_direcao"]
          entregue_em?: string | null
          enviada_por?: string | null
          enviado_em?: string | null
          erro?: string | null
          id?: string
          instancia_id: string
          legenda?: string | null
          lido_em?: string | null
          media_url?: string | null
          os_id?: string | null
          payload?: Json
          recebido_em?: string | null
          status?: Database["public"]["Enums"]["whatsapp_mensagem_status"]
          storage_bucket?: string | null
          storage_path?: string | null
          texto?: string | null
          tipo?: Database["public"]["Enums"]["whatsapp_mensagem_tipo"]
          updated_at?: string
          zapi_message_id?: string | null
        }
        Update: {
          arquivo_id?: string | null
          cliente_id?: string | null
          conversa_id?: string
          created_at?: string
          direcao?: Database["public"]["Enums"]["whatsapp_mensagem_direcao"]
          entregue_em?: string | null
          enviada_por?: string | null
          enviado_em?: string | null
          erro?: string | null
          id?: string
          instancia_id?: string
          legenda?: string | null
          lido_em?: string | null
          media_url?: string | null
          os_id?: string | null
          payload?: Json
          recebido_em?: string | null
          status?: Database["public"]["Enums"]["whatsapp_mensagem_status"]
          storage_bucket?: string | null
          storage_path?: string | null
          texto?: string | null
          tipo?: Database["public"]["Enums"]["whatsapp_mensagem_tipo"]
          updated_at?: string
          zapi_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_mensagens_arquivo_id_fkey"
            columns: ["arquivo_id"]
            isOneToOne: false
            referencedRelation: "arquivos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_mensagens_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_mensagens_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_mensagens_enviada_por_fkey"
            columns: ["enviada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_mensagens_instancia_id_fkey"
            columns: ["instancia_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instancias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_mensagens_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_mensagens_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_mensagens_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_mensagens_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "whatsapp_mensagens_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "whatsapp_mensagens_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "whatsapp_mensagens_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
        ]
      }
      whatsapp_participantes: {
        Row: {
          conversa_id: string
          created_at: string
          papel: string
          usuario_id: string
        }
        Insert: {
          conversa_id: string
          created_at?: string
          papel?: string
          usuario_id: string
        }
        Update: {
          conversa_id?: string
          created_at?: string
          papel?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_participantes_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_participantes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_webhook_eventos: {
        Row: {
          created_at: string
          erro: string | null
          external_id: string
          id: string
          payload: Json
          processado_em: string | null
          provedor: string
        }
        Insert: {
          created_at?: string
          erro?: string | null
          external_id: string
          id?: string
          payload: Json
          processado_em?: string | null
          provedor: string
        }
        Update: {
          created_at?: string
          erro?: string | null
          external_id?: string
          id?: string
          payload?: Json
          processado_em?: string | null
          provedor?: string
        }
        Relationships: []
      }
    }
    Views: {
      itens_os_financeiro: {
        Row: {
          created_at: string | null
          custo_unitario: number | null
          descricao: string | null
          id: string | null
          ordem: number | null
          os_id: string | null
          quantidade: number | null
          unidade: string | null
          valor_total: number | null
          valor_unitario: number | null
        }
        Relationships: [
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
        ]
      }
      itens_os_operacional: {
        Row: {
          created_at: string | null
          descricao: string | null
          id: string | null
          ordem: number | null
          os_id: string | null
          quantidade: number | null
          unidade: string | null
        }
        Insert: {
          created_at?: string | null
          descricao?: string | null
          id?: string | null
          ordem?: number | null
          os_id?: string | null
          quantidade?: number | null
          unidade?: string | null
        }
        Update: {
          created_at?: string | null
          descricao?: string | null
          id?: string | null
          ordem?: number | null
          os_id?: string | null
          quantidade?: number | null
          unidade?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
        ]
      }
      materiais_financeiro: {
        Row: {
          created_at: string | null
          custo_unitario: number | null
          estoque: number | null
          id: string | null
          nome: string | null
          unidade: string | null
        }
        Relationships: []
      }
      materiais_operacional: {
        Row: {
          created_at: string | null
          estoque: number | null
          id: string | null
          nome: string | null
          unidade: string | null
        }
        Insert: {
          created_at?: string | null
          estoque?: number | null
          id?: string | null
          nome?: string | null
          unidade?: string | null
        }
        Update: {
          created_at?: string | null
          estoque?: number | null
          id?: string | null
          nome?: string | null
          unidade?: string | null
        }
        Relationships: []
      }
      orcamento_itens_financeiro: {
        Row: {
          created_at: string | null
          custo_unitario: number | null
          descricao: string | null
          id: string | null
          orcamento_id: string | null
          ordem: number | null
          quantidade: number | null
          unidade: string | null
          valor_total: number | null
          valor_unitario: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_itens_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_itens_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_itens_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_operacional"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamento_itens_operacional: {
        Row: {
          created_at: string | null
          descricao: string | null
          id: string | null
          orcamento_id: string | null
          ordem: number | null
          quantidade: number | null
          unidade: string | null
        }
        Insert: {
          created_at?: string | null
          descricao?: string | null
          id?: string | null
          orcamento_id?: string | null
          ordem?: number | null
          quantidade?: number | null
          unidade?: string | null
        }
        Update: {
          created_at?: string | null
          descricao?: string | null
          id?: string | null
          orcamento_id?: string | null
          ordem?: number | null
          quantidade?: number | null
          unidade?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_itens_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_itens_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_itens_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_operacional"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamentos_financeiro: {
        Row: {
          aprovado_em: string | null
          cliente_id: string | null
          cliente_nome: string | null
          created_at: string | null
          created_by: string | null
          custo_estimado: number | null
          desconto_percentual: number | null
          descricao: string | null
          enviado_em: string | null
          id: string | null
          margem_estimada: number | null
          numero: number | null
          observacoes: string | null
          os_id: string | null
          status: Database["public"]["Enums"]["status_orcamento"] | null
          titulo: string | null
          updated_at: string | null
          validade_dias: number | null
          valor_subtotal: number | null
          valor_total: number | null
          vendedor_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orcamentos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "orcamentos_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamentos_operacional: {
        Row: {
          aprovado_em: string | null
          cliente_id: string | null
          cliente_nome: string | null
          created_at: string | null
          created_by: string | null
          descricao: string | null
          enviado_em: string | null
          id: string | null
          numero: number | null
          observacoes: string | null
          os_id: string | null
          status: Database["public"]["Enums"]["status_orcamento"] | null
          titulo: string | null
          updated_at: string | null
          validade_dias: number | null
          vendedor_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orcamentos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "orcamentos_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      ordens_servico_financeiro: {
        Row: {
          briefing: string | null
          cliente_id: string | null
          cliente_logo_url: string | null
          cliente_nome: string | null
          created_at: string | null
          created_by: string | null
          custo_previsto: number | null
          custo_real: number | null
          data_entrega_real: string | null
          designer_id: string | null
          id: string | null
          margem_real: number | null
          numero: number | null
          observacoes: string | null
          operador_id: string | null
          orcamento_id: string | null
          ordem_kanban: number | null
          prazo_entrega: string | null
          prioridade: number | null
          responsavel_id: string | null
          status: Database["public"]["Enums"]["status_os"] | null
          titulo: string | null
          updated_at: string | null
          valor_total: number | null
          vendedor_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ordens_servico_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_designer_id_fkey"
            columns: ["designer_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_operador_id_fkey"
            columns: ["operador_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      ordens_servico_operacional: {
        Row: {
          briefing: string | null
          cliente_id: string | null
          cliente_logo_url: string | null
          cliente_nome: string | null
          created_at: string | null
          created_by: string | null
          data_entrega_real: string | null
          designer_id: string | null
          id: string | null
          numero: number | null
          observacoes: string | null
          operador_id: string | null
          orcamento_id: string | null
          ordem_kanban: number | null
          prazo_entrega: string | null
          prioridade: number | null
          responsavel_id: string | null
          status: Database["public"]["Enums"]["status_os"] | null
          titulo: string | null
          updated_at: string | null
          vendedor_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ordens_servico_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_designer_id_fkey"
            columns: ["designer_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_operador_id_fkey"
            columns: ["operador_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      produtos_operacional: {
        Row: {
          ativo: boolean | null
          created_at: string | null
          descricao: string | null
          id: string | null
          nome: string | null
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string | null
          descricao?: string | null
          id?: string | null
          nome?: string | null
        }
        Update: {
          ativo?: boolean | null
          created_at?: string | null
          descricao?: string | null
          id?: string | null
          nome?: string | null
        }
        Relationships: []
      }
      rel_faturamento_por_periodo: {
        Row: {
          faturamento: number | null
          ordens_servico: number | null
          pagamentos: number | null
          periodo: string | null
        }
        Relationships: []
      }
      rel_lucro_por_os: {
        Row: {
          cliente: string | null
          criada_em: string | null
          custo: number | null
          lucro: number | null
          margem_percentual: number | null
          numero: number | null
          os_id: string | null
          receita: number | null
          status: Database["public"]["Enums"]["status_os"] | null
          titulo: string | null
        }
        Relationships: []
      }
      rel_margem_por_produto: {
        Row: {
          custo: number | null
          margem_percentual: number | null
          margem_valor: number | null
          primeira_venda: string | null
          produto: string | null
          quantidade: number | null
          receita: number | null
          ultima_venda: string | null
        }
        Relationships: []
      }
      rel_os_atrasadas: {
        Row: {
          cliente: string | null
          dias_atraso: number | null
          numero: number | null
          os_id: string | null
          prazo_entrega: string | null
          status: Database["public"]["Enums"]["status_os"] | null
          titulo: string | null
          valor_total: number | null
        }
        Relationships: []
      }
      rel_producao_por_maquina: {
        Row: {
          apontamentos: number | null
          horas_produzidas: number | null
          maquina: string | null
          maquina_id: string | null
          ordens_servico: number | null
          primeiro_apontamento: string | null
          quantidade_produzida: number | null
          tipo: string | null
          ultimo_apontamento: string | null
        }
        Relationships: []
      }
      rel_retrabalho_por_setor: {
        Row: {
          custo_total: number | null
          ocorrencias: number | null
          primeira_ocorrencia: string | null
          retrabalhos: number | null
          setor: string | null
          ultima_ocorrencia: string | null
        }
        Relationships: []
      }
      rel_tempo_medio_por_etapa: {
        Row: {
          apontamentos_concluidos: number | null
          etapa: string | null
          horas_maxima: number | null
          horas_media: number | null
          horas_minima: number | null
        }
        Relationships: []
      }
      rel_whatsapp_conversas_abertas: {
        Row: {
          aberta_em: string | null
          atendente: string | null
          contato_nome: string | null
          conversa_id: string | null
          etiqueta: string | null
          mensagens_entrada: number | null
          mensagens_saida: number | null
          telefone: string | null
          ultima_mensagem_em: string | null
        }
        Relationships: []
      }
      rel_whatsapp_tempo_medio_resposta: {
        Row: {
          atendente: string | null
          contato_nome: string | null
          conversa_id: string | null
          minutos_media_resposta: number | null
          respostas: number | null
        }
        Relationships: []
      }
      role_permission_matrix: {
        Row: {
          permission: string | null
          role: Database["public"]["Enums"]["app_role"] | null
        }
        Relationships: []
      }
      vw_dashboard_atendimento: {
        Row: {
          abertas: number | null
          conversas: number | null
        }
        Relationships: []
      }
      vw_dashboard_comercial: {
        Row: {
          margem_prevista: number | null
          orcamentos_mes: number | null
          ticket_medio: number | null
        }
        Relationships: []
      }
      vw_dashboard_estoque: {
        Row: {
          abaixo_minimo: number | null
          reservas: number | null
        }
        Relationships: []
      }
      vw_dashboard_financeiro: {
        Row: {
          custo: number | null
          faturamento: number | null
          lucro: number | null
          margem: number | null
        }
        Relationships: []
      }
      vw_dashboard_impressao_3d: {
        Row: {
          custo_previsto: number | null
          custo_real: number | null
          falhas: number | null
          gramas_consumidas: number | null
          horas_impressas: number | null
          jobs: number | null
          margem_real: number | null
        }
        Relationships: []
      }
      vw_dashboard_logistica: {
        Row: {
          entregas: number | null
          status: string | null
        }
        Relationships: []
      }
      vw_dashboard_maquinas: {
        Row: {
          horas_produtivas: number | null
          maquinas: number | null
        }
        Relationships: []
      }
      vw_dashboard_operacao: {
        Row: {
          os: number | null
          status: Database["public"]["Enums"]["status_os"] | null
        }
        Relationships: []
      }
      vw_dashboard_prazos: {
        Row: {
          atrasadas: number | null
        }
        Relationships: []
      }
      vw_dashboard_qualidade: {
        Row: {
          inspecoes: number | null
          resultado: string | null
        }
        Relationships: []
      }
      vw_dashboard_retrabalho: {
        Row: {
          custo: number | null
          retrabalhos: number | null
        }
        Relationships: []
      }
      vw_estoque_critico: {
        Row: {
          critico: boolean | null
          estoque_minimo: number | null
          material_id: string | null
          nome: string | null
          saldo_disponivel: number | null
          saldo_fisico: number | null
          saldo_reservado: number | null
        }
        Relationships: []
      }
      vw_resultado_operacional_os: {
        Row: {
          custo_previsto: number | null
          custo_realizado: number | null
          divergencia: number | null
          lucro_operacional_realizado: number | null
          lucro_previsto: number | null
          margem_operacional: number | null
          margem_prevista: number | null
          os_id: string | null
          receita: number | null
          retrabalho: number | null
        }
        Relationships: []
      }
      vw_resultado_os: {
        Row: {
          atraso: boolean | null
          custo_previsto: number | null
          custo_realizado: number | null
          custo_reservado: number | null
          descontos: number | null
          divergencia_custo: number | null
          lucro_previsto: number | null
          lucro_realizado: number | null
          margem_prevista: number | null
          margem_realizada: number | null
          os_id: string | null
          receita_bruta: number | null
          receita_liquida: number | null
          retrabalho: number | null
          status_financeiro:
            | Database["public"]["Enums"]["status_pagamento"]
            | null
        }
        Insert: {
          atraso?: never
          custo_previsto?: never
          custo_realizado?: never
          custo_reservado?: never
          descontos?: never
          divergencia_custo?: never
          lucro_previsto?: never
          lucro_realizado?: never
          margem_prevista?: never
          margem_realizada?: never
          os_id?: string | null
          receita_bruta?: never
          receita_liquida?: never
          retrabalho?: never
          status_financeiro?: never
        }
        Update: {
          atraso?: never
          custo_previsto?: never
          custo_realizado?: never
          custo_reservado?: never
          descontos?: never
          divergencia_custo?: never
          lucro_previsto?: never
          lucro_realizado?: never
          margem_prevista?: never
          margem_realizada?: never
          os_id?: string | null
          receita_bruta?: never
          receita_liquida?: never
          retrabalho?: never
          status_financeiro?: never
        }
        Relationships: []
      }
      vw_tarefas_kanban: {
        Row: {
          anexos: Json | null
          bloqueia_dependentes: boolean | null
          checklist: Json | null
          comentarios: Json | null
          completed_by: string | null
          created_at: string | null
          created_by: string | null
          dependencias: Json | null
          descricao: string | null
          fim_previsto: string | null
          fim_real: string | null
          id: string | null
          inicio_previsto: string | null
          inicio_real: string | null
          minutos_previstos: number | null
          minutos_realizados: number | null
          obrigatoria: boolean | null
          os_id: string | null
          os_item_id: string | null
          prazo: string | null
          prioridade: string | null
          responsavel_id: string | null
          setor: string | null
          status: string | null
          titulo: string | null
          updated_at: string | null
        }
        Insert: {
          anexos?: Json | null
          bloqueia_dependentes?: boolean | null
          checklist?: Json | null
          comentarios?: Json | null
          completed_by?: string | null
          created_at?: string | null
          created_by?: string | null
          dependencias?: Json | null
          descricao?: string | null
          fim_previsto?: string | null
          fim_real?: string | null
          id?: string | null
          inicio_previsto?: string | null
          inicio_real?: string | null
          minutos_previstos?: number | null
          minutos_realizados?: number | null
          obrigatoria?: boolean | null
          os_id?: string | null
          os_item_id?: string | null
          prazo?: string | null
          prioridade?: string | null
          responsavel_id?: string | null
          setor?: string | null
          status?: string | null
          titulo?: string | null
          updated_at?: string | null
        }
        Update: {
          anexos?: Json | null
          bloqueia_dependentes?: boolean | null
          checklist?: Json | null
          comentarios?: Json | null
          completed_by?: string | null
          created_at?: string | null
          created_by?: string | null
          dependencias?: Json | null
          descricao?: string | null
          fim_previsto?: string | null
          fim_real?: string | null
          id?: string | null
          inicio_previsto?: string | null
          inicio_real?: string | null
          minutos_previstos?: number | null
          minutos_realizados?: number | null
          obrigatoria?: boolean | null
          os_id?: string | null
          os_item_id?: string | null
          prazo?: string | null
          prioridade?: string | null
          responsavel_id?: string | null
          setor?: string | null
          status?: string | null
          titulo?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "os_tarefas_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_tarefas_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_tarefas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_tarefas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_tarefas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_tarefas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "os_tarefas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "os_tarefas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_operacional_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "os_tarefas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "vw_resultado_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "os_tarefas_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_tarefas_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_tarefas_os_item_id_fkey"
            columns: ["os_item_id"]
            isOneToOne: false
            referencedRelation: "itens_os_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_tarefas_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      vw_timeline_os: {
        Row: {
          created_at: string | null
          dados: Json | null
          descricao: string | null
          entidade: string | null
          entidade_id: string | null
          id: string | null
          os_id: string | null
          tipo: string | null
          titulo: string | null
          usuario_id: string | null
        }
        Insert: {
          created_at?: string | null
          dados?: Json | null
          descricao?: string | null
          entidade?: string | null
          entidade_id?: string | null
          id?: string | null
          os_id?: string | null
          tipo?: string | null
          titulo?: string | null
          usuario_id?: string | null
        }
        Update: {
          created_at?: string | null
          dados?: Json | null
          descricao?: string | null
          entidade?: string | null
          entidade_id?: string | null
          id?: string | null
          os_id?: string | null
          tipo?: string | null
          titulo?: string | null
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "eventos_negocio_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _apply_pending_migration: { Args: { p_sql: string }; Returns: undefined }
      aprovar_orcamento: {
        Args: {
          p_observacao?: string
          p_orcamento_id: string
          p_versao_id?: string
        }
        Returns: Json
      }
      automacao_condicao_ok: {
        Args: {
          p_condicao: Json
          p_contexto: Json
          p_gatilho: Database["public"]["Enums"]["automacao_gatilho"]
        }
        Returns: boolean
      }
      automacao_contexto_os: {
        Args: { p_os: Database["public"]["Tables"]["ordens_servico"]["Row"] }
        Returns: Json
      }
      avancar_os_status: {
        Args: {
          novo_status: Database["public"]["Enums"]["status_os"]
          os_id: string
        }
        Returns: {
          briefing: string | null
          cliente_id: string
          contato_id: string | null
          created_at: string
          created_by: string | null
          custo_previsto: number
          custo_real: number
          data_entrega_real: string | null
          data_fechamento: string | null
          desconto: number
          designer_id: string | null
          estoque_baixado: boolean
          estoque_baixado_em: string | null
          id: string
          lucro_previsto: number
          lucro_real: number
          maquina_id: string | null
          margem_prevista: number | null
          margem_real: number | null
          numero: number
          numero_os: number | null
          observacoes: string | null
          operador_id: string | null
          orcamento_id: string | null
          ordem_kanban: number
          prazo_cliente: string | null
          prazo_entrega: string | null
          prazo_interno: string | null
          precisa_entrega: boolean
          precisa_instalacao: boolean
          prioridade: number
          produto_id: string | null
          responsavel_id: string | null
          setor_atual: string | null
          status: Database["public"]["Enums"]["status_os"]
          status_arte: string
          status_comercial: string
          status_financeiro: Database["public"]["Enums"]["status_pagamento"]
          status_geral: string
          status_logistica: string
          status_producao: string
          titulo: string
          updated_at: string
          valor_total: number
          valor_venda: number
          vendedor_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "ordens_servico"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      baixar_estoque_os: {
        Args: { p_consumos?: Json; p_os_id: string }
        Returns: Json
      }
      can_see_financials: { Args: { _user_id: string }; Returns: boolean }
      confirmar_pagamento: {
        Args: {
          p_comprovante?: string
          p_data?: string
          p_meio: string
          p_parcela_id: string
          p_referencia_externa?: string
          p_taxa?: number
          p_valor: number
        }
        Returns: Json
      }
      confirmar_pagamento_registrado: {
        Args: {
          p_data?: string
          p_pagamento_id: string
          p_referencia_externa?: string
        }
        Returns: Json
      }
      converter_lead_em_cliente: {
        Args: { p_criar_orcamento?: boolean; p_dados: Json; p_lead_id: string }
        Returns: Json
      }
      converter_orcamento_em_os: {
        Args: { p_opcoes?: Json; p_orcamento_id: string }
        Returns: Json
      }
      criar_eventos_automacoes_recorrentes: { Args: never; Returns: number }
      enqueue_automacoes: {
        Args: {
          p_contexto?: Json
          p_entidade: string
          p_entidade_id: string
          p_gatilho: Database["public"]["Enums"]["automacao_gatilho"]
        }
        Returns: number
      }
      estornar_baixa_estoque_os: {
        Args: { p_motivo: string; p_movimentacao_origem_id: string }
        Returns: Json
      }
      estornar_pagamento: {
        Args: { p_motivo: string; p_pagamento_id: string }
        Returns: Json
      }
      fechar_os: { Args: { os_id: string }; Returns: Json }
      forcar_transicao_os: {
        Args: { p_motivo: string; p_novo_status: string; p_os_id: string }
        Returns: Json
      }
      get_relatorios_prioritarios: {
        Args: { p_fim?: string; p_inicio?: string }
        Returns: Json
      }
      has_any_permission: { Args: { _user_id: string }; Returns: boolean }
      has_permission: {
        Args: { _permission: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      normalize_document: { Args: { _doc: string }; Returns: string }
      normalize_email: { Args: { _email: string }; Returns: string }
      normalize_phone: { Args: { _phone: string }; Returns: string }
      normalize_whatsapp_phone: { Args: { _phone: string }; Returns: string }
      registrar_evento_os: {
        Args: {
          p_dados?: Json
          p_descricao?: string
          p_entidade: string
          p_entidade_id: string
          p_os_id: string
          p_tipo: string
          p_titulo: string
        }
        Returns: undefined
      }
      require_permission: { Args: { _permission: string }; Returns: string }
      reservar_materiais_os: { Args: { p_os_id: string }; Returns: Json }
      status_os_exige_validacoes_producao: {
        Args: { _status: Database["public"]["Enums"]["status_os"] }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "gestor"
        | "financeiro"
        | "vendedor"
        | "designer"
        | "operador"
        | "estoque"
        | "instalador"
        | "cliente"
      automacao_acao: "whatsapp"
      automacao_execucao_status:
        | "pendente"
        | "processando"
        | "sucesso"
        | "erro"
        | "ignorado"
      automacao_gatilho:
        | "status_os_alterado"
        | "pagamento_atrasado"
        | "estoque_minimo"
        | "margem_abaixo_minimo"
        | "os_atrasada"
        | "os_concluida"
      canal_aprovacao:
        | "sistema"
        | "whatsapp"
        | "email"
        | "presencial"
        | "telefone"
      categoria_produto:
        | "impressao_grande_formato"
        | "adesivos"
        | "comunicacao_visual"
        | "brindes"
        | "acabamento"
        | "instalacao"
        | "servico"
        | "outros"
      status_arquivo:
        | "ativo"
        | "substituido"
        | "inativo"
        | "aprovado"
        | "rejeitado"
      status_orcamento:
        | "rascunho"
        | "enviado"
        | "aprovado"
        | "rejeitado"
        | "expirado"
        | "convertido"
      status_os:
        | "entrada"
        | "aguardando_briefing"
        | "briefing_ok"
        | "design"
        | "aguardando_aprovacao_arte"
        | "arte_aprovada"
        | "arte_rejeitada"
        | "aguardando_producao"
        | "producao"
        | "em_producao"
        | "em_impressao"
        | "em_corte"
        | "em_acabamento"
        | "em_uv"
        | "em_laser_cnc"
        | "em_3d"
        | "controle_qualidade"
        | "aguardando_retirada"
        | "aguardando_entrega"
        | "em_entrega"
        | "em_instalacao"
        | "concluido"
        | "faturado"
        | "cancelado"
        | "retrabalho"
        | "pausado"
      status_pagamento:
        | "pendente"
        | "parcial"
        | "pago"
        | "atrasado"
        | "cancelado"
      tipo_aprovacao: "arte" | "orcamento" | "margem_baixa" | "desconto_alto"
      tipo_arquivo:
        | "arte"
        | "briefing"
        | "referencia"
        | "producao"
        | "orcamento"
        | "comprovante"
        | "outro"
      tipo_cliente: "pf" | "pj"
      tipo_item: "produto" | "servico"
      whatsapp_automacao_gatilho:
        | "mensagem_recebida"
        | "palavra_chave"
        | "fora_horario"
        | "primeiro_contato"
        | "status_conexao"
      whatsapp_conversa_status:
        | "aberta"
        | "pendente"
        | "resolvida"
        | "arquivada"
      whatsapp_instancia_status:
        | "desconectada"
        | "conectando"
        | "conectada"
        | "erro"
      whatsapp_log_tipo:
        | "envio_texto"
        | "envio_imagem"
        | "envio_documento"
        | "webhook_mensagem"
        | "webhook_status"
        | "webhook_conexao"
        | "erro"
      whatsapp_mensagem_direcao: "entrada" | "saida"
      whatsapp_mensagem_status:
        | "recebida"
        | "pendente"
        | "enviada"
        | "entregue"
        | "lida"
        | "falha"
      whatsapp_mensagem_tipo:
        | "texto"
        | "imagem"
        | "documento"
        | "audio"
        | "video"
        | "sticker"
        | "localizacao"
        | "contato"
        | "sistema"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "gestor",
        "financeiro",
        "vendedor",
        "designer",
        "operador",
        "estoque",
        "instalador",
        "cliente",
      ],
      automacao_acao: ["whatsapp"],
      automacao_execucao_status: [
        "pendente",
        "processando",
        "sucesso",
        "erro",
        "ignorado",
      ],
      automacao_gatilho: [
        "status_os_alterado",
        "pagamento_atrasado",
        "estoque_minimo",
        "margem_abaixo_minimo",
        "os_atrasada",
        "os_concluida",
      ],
      canal_aprovacao: [
        "sistema",
        "whatsapp",
        "email",
        "presencial",
        "telefone",
      ],
      categoria_produto: [
        "impressao_grande_formato",
        "adesivos",
        "comunicacao_visual",
        "brindes",
        "acabamento",
        "instalacao",
        "servico",
        "outros",
      ],
      status_arquivo: [
        "ativo",
        "substituido",
        "inativo",
        "aprovado",
        "rejeitado",
      ],
      status_orcamento: [
        "rascunho",
        "enviado",
        "aprovado",
        "rejeitado",
        "expirado",
        "convertido",
      ],
      status_os: [
        "entrada",
        "aguardando_briefing",
        "briefing_ok",
        "design",
        "aguardando_aprovacao_arte",
        "arte_aprovada",
        "arte_rejeitada",
        "aguardando_producao",
        "producao",
        "em_producao",
        "em_impressao",
        "em_corte",
        "em_acabamento",
        "em_uv",
        "em_laser_cnc",
        "em_3d",
        "controle_qualidade",
        "aguardando_retirada",
        "aguardando_entrega",
        "em_entrega",
        "em_instalacao",
        "concluido",
        "faturado",
        "cancelado",
        "retrabalho",
        "pausado",
      ],
      status_pagamento: [
        "pendente",
        "parcial",
        "pago",
        "atrasado",
        "cancelado",
      ],
      tipo_aprovacao: ["arte", "orcamento", "margem_baixa", "desconto_alto"],
      tipo_arquivo: [
        "arte",
        "briefing",
        "referencia",
        "producao",
        "orcamento",
        "comprovante",
        "outro",
      ],
      tipo_cliente: ["pf", "pj"],
      tipo_item: ["produto", "servico"],
      whatsapp_automacao_gatilho: [
        "mensagem_recebida",
        "palavra_chave",
        "fora_horario",
        "primeiro_contato",
        "status_conexao",
      ],
      whatsapp_conversa_status: [
        "aberta",
        "pendente",
        "resolvida",
        "arquivada",
      ],
      whatsapp_instancia_status: [
        "desconectada",
        "conectando",
        "conectada",
        "erro",
      ],
      whatsapp_log_tipo: [
        "envio_texto",
        "envio_imagem",
        "envio_documento",
        "webhook_mensagem",
        "webhook_status",
        "webhook_conexao",
        "erro",
      ],
      whatsapp_mensagem_direcao: ["entrada", "saida"],
      whatsapp_mensagem_status: [
        "recebida",
        "pendente",
        "enviada",
        "entregue",
        "lida",
        "falha",
      ],
      whatsapp_mensagem_tipo: [
        "texto",
        "imagem",
        "documento",
        "audio",
        "video",
        "sticker",
        "localizacao",
        "contato",
        "sistema",
      ],
    },
  },
} as const
