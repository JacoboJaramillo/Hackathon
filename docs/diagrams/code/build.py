"""Regenerates every architecture image in docs/diagrams/img/.

Requires: pip install diagrams==0.25.1 and Graphviz (dot) on PATH. Without admin
rights on Windows, the portable zip from the official Graphviz releases
(gitlab.com/graphviz/graphviz) works: unzip it and prepend its bin/ to PATH.
Usage, from the repository root: python docs/diagrams/code/build.py
"""
import os

from diagrams import Cluster, Diagram, Edge
from diagrams.gcp.compute import Run
from diagrams.gcp.devtools import Build, ContainerRegistry
from diagrams.gcp.network import LoadBalancing
from diagrams.gcp.operations import Logging
from diagrams.gcp.security import Iam, KeyManagementService, SecretManager
from diagrams.generic.database import SQL
from diagrams.generic.device import Mobile
from diagrams.generic.place import Datacenter
from diagrams.onprem.ci import GithubActions
from diagrams.onprem.client import Client, User
from diagrams.onprem.network import Internet
from diagrams.onprem.vcs import Github
from diagrams.generic.compute import Rack
from diagrams.generic.network import Firewall
from diagrams.generic.storage import Storage
from diagrams.programming.language import Javascript
from diagrams.programming.framework import Nextjs, React
from diagrams.programming.language import Nodejs

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "img")
FONT = "Segoe UI"

GRAPH = {
    "fontname": FONT, "fontsize": "22", "labelloc": "t", "pad": "0.6",
    "nodesep": "0.7", "ranksep": "1.3", "splines": "spline", "bgcolor": "white",
}
NODE = {"fontname": FONT, "fontsize": "13"}
EDGE = {"fontname": FONT, "fontsize": "11", "color": "#555555"}

# Soft fills per trust zone, reused in every diagram so colors mean the same thing.
ZONE_USER = {"bgcolor": "#FFF4E5", "pencolor": "#F0A04B", "fontname": FONT, "fontsize": "15", "style": "rounded"}
ZONE_EDGE = {"bgcolor": "#EAF2FF", "pencolor": "#5B8DEF", "fontname": FONT, "fontsize": "15", "style": "rounded"}
ZONE_SERVER = {"bgcolor": "#E9F7EF", "pencolor": "#3DA35D", "fontname": FONT, "fontsize": "15", "style": "rounded"}
ZONE_INNER = {"bgcolor": "#FFFFFF", "pencolor": "#3DA35D", "fontname": FONT, "fontsize": "13", "style": "rounded,dashed"}
ZONE_THIRD = {"bgcolor": "#F4EEFB", "pencolor": "#8E6CC8", "fontname": FONT, "fontsize": "15", "style": "rounded"}
ZONE_GCP = {"bgcolor": "#EEF1F4", "pencolor": "#7A8794", "fontname": FONT, "fontsize": "15", "style": "rounded"}
ZONE_DEV = {"bgcolor": "#FDF2F8", "pencolor": "#C2569B", "fontname": FONT, "fontsize": "15", "style": "rounded"}

BLUE, GREEN, PURPLE, ORANGE, RED, GRAY = "#2F6FDB", "#2E8B57", "#7B4FC0", "#D9822B", "#C0392B", "#7A8794"


def diagram(title, name, **overrides):
    return Diagram(title, filename=os.path.join(OUT, name), outformat="png", show=False,
                   direction="LR", graph_attr={**GRAPH, **overrides}, node_attr=NODE, edge_attr=EDGE)


def e(label="", color=GRAY, style="solid", back=False):
    # back=True keeps return edges from pulling the layout out of left-to-right order.
    return Edge(label=label, color=color, fontcolor=color, style=style, penwidth="1.6",
                constraint="false" if back else "true")


def contexto():
    with diagram("Vista general: ¿Dónde me atienden? (Gabriela)", "01-contexto"):
        persona = User("Ciudadano o jurado")
        with Cluster("Internet - no confiable", graph_attr=ZONE_USER):
            nav = Client("Navegador\nNext.js 15 + React 19\nmicrófono 16 kHz")
        with Cluster("Google Cloud - agente-vocal-hackaton (us-east1)", graph_attr=ZONE_GCP):
            run = Run("Cloud Run\nagente-vocal\nNode 24")
            sm = SecretManager("Secret Manager\n4 secretos")
        with Cluster("Terceros con contrato de servicio", graph_attr=ZONE_THIRD):
            dga = Datacenter("Deepgram Voice Agent\nSTT nova-3 + TTS\naura-2-celeste-es")
            dgs = Datacenter("Deepgram STT\nstreaming diarizado")
            ds = Datacenter("DeepSeek API\ndeepseek-chat")
            dt = SQL("datos.gov.co\nIPS s2ru-bqt6")
            wa = Mobile("Meta WhatsApp\nCloud API")
        maps = Internet("Google Maps\n(solo enlace)")

        persona >> e("habla y escucha", ORANGE) >> nav
        nav >> e("HTTPS + WSS /ws/agent\naudio PCM, documento", BLUE) >> run
        sm >> e("secretos al desplegar", GRAY, "dashed") >> run
        run >> e("WSS: Settings y audio", PURPLE) >> dga
        run >> e("WSS: mismo audio,\ndiarize=true", PURPLE) >> dgs
        dga >> e("think: chat completions", PURPLE) >> ds
        run >> e("HTTPS: brief y sentimiento", PURPLE) >> ds
        run >> e("HTTPS SoQL + X-App-Token", GREEN) >> dt
        run >> e("plantilla sedes_salud_v1\n(opcional, RF-024)", GREEN) >> wa
        nav >> e("la persona toca el enlace", GRAY, "dotted") >> maps


def contenedores():
    with diagram("Contenedores y módulos del servicio agente-vocal", "02-contenedores", nodesep="0.3", ranksep="0.9"):
        with Cluster("Navegador (Chrome / Edge)", graph_attr=ZONE_USER):
            ui = React("Interfaz Next.js 15\nReact 19 - paneles")
            voice = Javascript("useVoiceSession\nAudioWorklet 16 kHz\nreproducción 24 kHz")
            up = React("DocumentUpload\ncarga y brief")
        with Cluster("Cloud Run - contenedor único Node 24 (server.mjs)", graph_attr=ZONE_SERVER):
            with Cluster("Entrada", graph_attr=ZONE_INNER):
                nextjs = Nextjs("Next.js pages\nGET /api/health")
                lim = Firewall("limits.mjs\nOrigin, tasa, cupos")
                srv = Nodejs("Proxy WebSocket\n/ws/agent")
                api = Javascript("POST /api/document")
            with Cluster("Documento", graph_attr=ZONE_INNER):
                docs = Storage("documents.mjs\nalmacén en memoria 30 min")
                worker = Rack("parse-worker.mjs\nworker_threads")
                brief = Javascript("brief.mjs")
            with Cluster("Voz y análisis", graph_attr=ZONE_INNER):
                settings = Javascript("agent-settings.mjs\nprompt de Gabriela")
                diar = Javascript("diarize.mjs")
                sent = Javascript("sentiment.mjs")
            with Cluster("Herramientas del agente", graph_attr=ZONE_INNER):
                ips = Javascript("buscar_sedes\nips.mjs + caché")
                snap = Storage("ips-snapshot.json.gz\nrespaldo offline")
                wap = Javascript("enviar_whatsapp\nwhatsapp.mjs + límites")
        with Cluster("Terceros", graph_attr=ZONE_THIRD):
            dga = Datacenter("Deepgram\nVoice Agent")
            dgs = Datacenter("Deepgram STT\ndiarizado")
            ds = Datacenter("DeepSeek")
            dt = SQL("datos.gov.co")
            wa = Mobile("WhatsApp\nCloud API")

        ui >> e("HTTPS", BLUE) >> nextjs
        voice >> e("WSS audio + AskText", BLUE) >> lim >> e("admitida", GREEN) >> srv
        up >> e("multipart", BLUE) >> api >> docs >> worker
        api >> brief >> e("HTTPS", PURPLE) >> ds
        srv >> settings
        srv >> e("WSS", PURPLE) >> dga
        srv >> diar >> e("WSS", PURPLE) >> dgs
        diar >> sent >> e("HTTPS", PURPLE) >> ds
        srv >> e("FunctionCallRequest", GREEN) >> ips >> e("HTTPS", GREEN) >> dt
        ips >> e("si falla la API", ORANGE, "dashed") >> snap
        srv >> e("FunctionCallRequest", GREEN) >> wap >> e("HTTPS Bearer", GREEN) >> wa


def flujo_voz():
    with diagram("Flujo de una conversación de voz", "03-flujo-voz"):
        with Cluster("Navegador", graph_attr=ZONE_USER):
            mic = User("Micrófono\nPCM 16 kHz")
            spk = Client("Parlante\naudio 24 kHz")
            panel = React("Transcripción\ny sentimiento")
        with Cluster("Cloud Run - agente-vocal", graph_attr=ZONE_SERVER):
            srv = Nodejs("Proxy /ws/agent")
            ips = Javascript("buscar_sedes\nips.mjs")
            snap = Storage("snapshot offline")
            diar = Javascript("diarize.mjs")
            sent = Javascript("sentiment.mjs")
        with Cluster("Deepgram", graph_attr=ZONE_THIRD):
            dga = Datacenter("Voice Agent\nSTT nova-3, think,\nTTS aura-2-celeste-es")
            dgs = Datacenter("STT streaming\ndiarize=true")
        with Cluster("Otros terceros", graph_attr=ZONE_THIRD):
            ds = Datacenter("DeepSeek\ndeepseek-chat")
            dt = SQL("datos.gov.co\ns2ru-bqt6")

        mic >> e("1. audio PCM", BLUE) >> srv
        srv >> e("2. Settings + audio", PURPLE) >> dga
        dga >> e("3. think: texto del usuario", PURPLE) >> ds
        dga >> e("4. FunctionCallRequest\nbuscar_sedes", GREEN, back=True) >> srv
        srv >> e("5. args validados", GREEN) >> ips
        ips >> e("6a. SoQL + X-App-Token", GREEN) >> dt
        ips >> e("6b. si la API falla", ORANGE, "dashed") >> snap
        srv >> e("7. FunctionCallResponse", GREEN) >> dga
        ds >> e("8. respuesta en texto", PURPLE, back=True) >> dga
        dga >> e("9. audio TTS 24 kHz", PURPLE, back=True) >> srv
        srv >> e("10. audio al parlante", BLUE, back=True) >> spk
        srv >> e("11. copia del audio", RED) >> diar >> e("WSS", RED) >> dgs
        diar >> e("12. intervención", RED) >> sent >> e("13. clasificar", RED) >> ds
        sent >> e("14. Transcript + Sentiment", RED, back=True) >> panel


def despliegue():
    with diagram("Despliegue y DevOps", "04-despliegue"):
        dev = User("Desarrollador")
        with Cluster("GitHub", graph_attr=ZONE_DEV):
            gh = Github("Repositorio")
            ci = GithubActions("CI: lint, pruebas,\ngitleaks, npm audit, build\n(no despliega)")
        with Cluster("Proyecto GCP agente-vocal-hackaton - us-east1", graph_attr=ZONE_GCP):
            with Cluster("IAM", graph_attr=ZONE_INNER):
                sab = Iam("agente-vocal-build\nlogWriter, objectViewer,\nartifactregistry.writer")
                sar = Iam("agente-vocal-run\nsecretAccessor")
            cb = Build("Cloud Build")
            ar = ContainerRegistry("Artifact Registry\ncloud-run-source-deploy")
            sm = SecretManager("Secret Manager\nversiones fijadas")
            run = Run("Cloud Run agente-vocal\nrevisión nueva\nmax 2 instancias, 1 GiB")
            logs = Logging("Cloud Logging\nJSON estructurado")
        jurado = Client("Navegador\ndel jurado")

        dev >> e("git push", ORANGE) >> gh >> e("push / PR", ORANGE) >> ci
        dev >> e("bash infra/deploy.sh\ngcloud run deploy --source web", BLUE) >> cb
        sab >> e("identidad del build", GRAY, "dashed") >> cb
        cb >> e("imagen node:24-slim", BLUE) >> ar >> e("imagen", BLUE) >> run
        sar >> e("identidad de runtime", GRAY, "dashed") >> run
        sm >> e("deepseek, deepgram,\ndatosgov, whatsapp", GREEN) >> run
        run >> e("stdout", GRAY) >> logs
        jurado >> e("HTTPS + WSS\nafinidad de sesión", BLUE) >> run


def seguridad():
    with diagram("Seguridad y límites de confianza", "05-seguridad"):
        with Cluster("Zona 0 - Internet, no confiable", graph_attr=ZONE_USER):
            nav = Client("Navegador\n(nunca ve claves)")
        with Cluster("Zona 1 - borde de Google", graph_attr=ZONE_EDGE):
            gfe = LoadBalancing("Front end de Cloud Run\nTLS, X-Forwarded-For")
        with Cluster("Zona 2 - nuestro servidor, confiable", graph_attr=ZONE_SERVER):
            adm = Firewall("Admisión\nlimits.mjs")
            proxy = Nodejs("Proxy de sesión\nserver.mjs")
            docs = Javascript("documents.mjs\nworker aislado")
            tool = Javascript("buscar_sedes\nenviar_whatsapp")
            env = KeyManagementService("Claves en memoria\ndel proceso")
        with Cluster("Zona 3 - terceros", graph_attr=ZONE_THIRD):
            dg = Datacenter("Deepgram")
            ds = Datacenter("DeepSeek")
            dt = SQL("datos.gov.co")
            wa = Mobile("WhatsApp")
        with Cluster("Zona 4 - plano de control GCP", graph_attr=ZONE_GCP):
            sm = SecretManager("Secret Manager")
            iam = Iam("IAM mínimo privilegio")

        nav >> e("B1: HTTPS/WSS", BLUE) >> gfe
        gfe >> e("Origin en lista blanca\n10 intentos/min por IP\n2 por IP, 8 globales", RED) >> adm
        adm >> e("admitida (10 min máx.)", GREEN) >> proxy
        gfe >> e("B5: subida máx. 20 MB\nmagic bytes, tope de memoria", RED) >> docs
        proxy >> e("B2: solo audio y KeepAlive suben\nsolo eventos de lista blanca bajan", PURPLE) >> dg
        docs >> e("B2: texto cercado <documento>\ncontra inyección de prompt", PURPLE) >> ds
        proxy >> e("B3: args validados,\nliterales SoQL escapados", GREEN) >> tool
        tool >> e("X-App-Token", GREEN) >> dt
        tool >> e("texto armado por el servidor", GREEN) >> wa
        iam >> e("secretAccessor solo runtime", GRAY, "dashed") >> sm
        sm >> e("B4: claves solo en el servidor", RED) >> env
        env >> e("Settings con clave DeepSeek\n(nunca al navegador)", RED, "dashed") >> proxy


def whatsapp():
    with diagram("Integración WhatsApp (RF-024)", "06-whatsapp"):
        persona = User("Persona")
        with Cluster("Navegador", graph_attr=ZONE_USER):
            nav = Client("Conversación\ncon Gabriela")
        with Cluster("Cloud Run - agente-vocal", graph_attr=ZONE_SERVER):
            srv = Nodejs("server.mjs")
            last = Storage("Última búsqueda\nexitosa (copia)")
            val = Firewall("validateArgs\ncelular colombiano\nmáx. 3 posiciones")
            lim = Firewall("Límites en memoria\n1 por IP / 10 min\n1 por número (hash) / 10 min\n3 por hora en total")
            build = Javascript("Mensaje armado\nen el servidor")
        with Cluster("Terceros", graph_attr=ZONE_THIRD):
            dg = Datacenter("Deepgram + DeepSeek\n(el modelo pide la herramienta)")
            wa = Mobile("Meta WhatsApp Cloud API\nplantilla sedes_salud_v1")
        tel = Mobile("Celular\nde la persona")

        persona >> e("1. acepta y dicta su número", ORANGE) >> nav
        nav >> e("2. audio", BLUE) >> srv >> e("3. audio", PURPLE) >> dg
        dg >> e("4. enviar_whatsapp\n{telefono, sedes}", PURPLE) >> val
        val >> e("5. válido", GREEN) >> lim
        lim >> e("6. dentro del cupo", GREEN) >> build
        last >> e("datos del registro,\nno del modelo", GREEN, "dashed") >> build
        build >> e("7. HTTPS Bearer, 8 s,\nsin reintento", GREEN) >> wa >> e("8. mensaje", GREEN) >> tel


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for fn in (contexto, contenedores, flujo_voz, despliegue, seguridad, whatsapp):
        fn()
        print("ok", fn.__name__)
