# Oracle Cloud Always Free - Controle

Este deploy sobe uma instancia paralela chamada `Controle`, sem derrubar o Railway.

## Requisitos

- VM Ubuntu ARM64 ou AMD64 na Oracle Cloud.
- Porta `3001/tcp` liberada no Security List/NSG da Oracle.
- Acesso SSH para o usuario `ubuntu`.

## Subir na VM

```bash
curl -fsSL https://raw.githubusercontent.com/iatimcll-blip/Acompanhamento-e-alertas/master/deploy/oracle/bootstrap-controle.sh -o bootstrap-controle.sh
chmod +x bootstrap-controle.sh
./bootstrap-controle.sh
```

Depois edite `/opt/painel-acionamentos/.env`:

```bash
nano /opt/painel-acionamentos/.env
```

Reinicie:

```bash
cd /opt/painel-acionamentos
sudo docker compose --env-file .env -f docker-compose.controle.yml up -d --build
```

## Verificar

```bash
curl http://127.0.0.1:3001/api/config
sudo docker compose -f /opt/painel-acionamentos/docker-compose.controle.yml ps
sudo docker compose -f /opt/painel-acionamentos/docker-compose.controle.yml logs -f
```

## Observacoes

- Para teste paralelo, deixe `SHEETS_WEBHOOK_URL` vazio ou use uma planilha separada.
- A instancia `Controle` tem sessao WhatsApp propria em volume Docker (`controle-data:/data`).
- Sera necessario escanear um QR Code novo nessa instancia.
