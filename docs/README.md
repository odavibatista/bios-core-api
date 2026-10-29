# Documentação técnica do bios-core-api

🇧🇷 **Português** · 🇺🇸 [English](en/README.md)

[← Voltar ao README do projeto](../README.md)

Como a API funciona por dentro: cada decisão de implementação, o motivo dela e onde ela está no código.
Os requisitos, os casos de uso e a modelagem ficam no repositório
[bios-docs](https://github.com/odavibatista/bios-docs); aqui os mesmos identificadores (UC, RF, NF, IA,
INL) apontam de volta para eles.

## Índice

### Primeiros passos

| Nº | Documento | Conteúdo |
| --- | --- | --- |
| 01 | [Como rodar](01-Como-Rodar.md) | Pré-requisitos, primeiros passos e scripts do projeto |
| 02 | [Arquitetura e convenções](02-Arquitetura.md) | Organização em módulos e camadas, e as convenções de código |
| 03 | [Contrato da API (OpenAPI e CORS)](03-Contrato-da-API.md) | Documento OpenAPI, geração de cliente para o front e CORS |

### Fundamentos

| Nº | Documento | Conteúdo |
| --- | --- | --- |
| 04 | [Banco de dados e carga inicial](04-Banco-de-Dados.md) | Prisma sobre MongoDB, retenção por índices TTL e carga dos catálogos num banco novo |
| 05 | [Filas (BullMQ)](05-Filas.md) | Filas, consumidores, agendamentos e políticas de repetição |
| 06 | [Autenticação e contas](06-Autenticação-e-Contas.md) | Sessões, renovação, guard, senha, manutenção da conta e blacklist de domínios |
| 07 | [Segurança](07-Segurança.md) | Limite de requisições, criptografia de dados sensíveis e honeypot |
| 08 | [Cache de consultas](08-Cache.md) | Cache das consultas por CNPJ no Redis |
| 09 | [E-mails transacionais](09-E-mails.md) | Templates, envio pela fila e auditoria de cada disparo |

### Dados e fontes

| Nº | Documento | Conteúdo |
| --- | --- | --- |
| 10 | [Fontes externas (adapters)](10-Fontes-Externas.md) | Adapters das fontes públicas, cadeia de fallback cadastral e descrição dos CNAEs |
| 11 | [Evidências](11-Evidências.md) | Modelo e persistência, consolidação por CNPJ, referências às fontes, motivos de UNKNOWN e a CGU |
| 12 | [IBAMA](12-IBAMA.md) | Dumps do IBAMA: download, leitura, normalização, job diário e consulta avulsa |
| 13 | [Inventário GHG Protocol](13-GHG-Protocol.md) | Inventários de emissões do Registro Público do GHG Protocol |

### Funcionalidades

| Nº | Documento | Conteúdo |
| --- | --- | --- |
| 14 | [Índices por ODS](14-Índices-por-ODS.md) | Índice e confiança, recálculo por fila, explicação, catálogo de ODS e evolução setorial |
| 15 | [Empresas](15-Empresas.md) | Consulta por CNPJ, perfil completo, pesquisa e exportação em XLSX |
| 16 | [Chaves de API e API pública](16-Chaves-de-API.md) | Gestão das chaves pelo painel e consulta de perfil por chave |

### Qualidade

| Nº | Documento | Conteúdo |
| --- | --- | --- |
| 17 | [Testes](17-Testes.md) | Cobertura, testes e2e em paralelo e dados de teste |
| 18 | [Qualidade e integração contínua](18-Qualidade-e-CI.md) | Hooks locais, pipeline do CI e fluxo de contribuição |

## Por onde começar

- **Vai rodar a API?** [01. Como rodar](01-Como-Rodar.md).
- **Vai consumir a API (front ou integração)?** [03. Contrato da API](03-Contrato-da-API.md), depois
  [06. Autenticação e contas](06-Autenticação-e-Contas.md) e [15. Empresas](15-Empresas.md).
- **Quer entender o cálculo?** [11. Evidências](11-Evidências.md) e
  [14. Índices por ODS](14-Índices-por-ODS.md).
- **Vai contribuir com código?** [02. Arquitetura e convenções](02-Arquitetura.md),
  [17. Testes](17-Testes.md) e [18. Qualidade e integração contínua](18-Qualidade-e-CI.md).

A referência interativa de cada rota, com os modelos e os erros, fica em `/docs` com a API no ar.
