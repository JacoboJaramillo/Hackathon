# ADR 0001: Misión del agente "¿Dónde me atienden?"

Estado: aceptada, abierta a crítica del equipo. Fecha: 2026-10-09.

## Contexto

El reto exige un agente de voz que converse sobre un documento sorpresa y que consuma por API el dataset "Relación de IPS públicas y privadas según el nivel de atención y capacidad instalada" (`s2ru-bqt6`, datos.gov.co). Se quiere un agente con una misión única y estrecha, dirigida al ciudadano y no a empresas.

Lo que el dataset tiene, por sede de salud: departamento, municipio, nombre de sede y de prestador, dirección, teléfono, naturaleza (pública, privada, mixta), nivel de atención (solo unas 1.300 sedes públicas de unas 11.000) y capacidad instalada por tipo (camas, salas, sillas, consultorios, camillas, ambulancias, unidades móviles) con su cantidad. Corte: noviembre de 2022.

Lo que no tiene: especialidades médicas, EPS que atiende cada sede, horarios, disponibilidad en tiempo real, costos ni coordenadas. No existe en datos.gov.co un dataset nacional de servicios habilitados por especialidad (solo departamentales: Boyacá, Casanare, Valle).

## Decisión

Misión: **ayudar a una persona a encontrar en qué sede de salud de su municipio puede recibir la atención que necesita**, usando el registro oficial de prestadores y, si lo sube, su documento (orden médica, remisión, carta de la EPS).

Opciones descartadas: auditor de red para EPS (el usuario final es el ciudadano, no la empresa), traductor de documentos (usa poco los datos), perfil de cobertura del municipio (informa pero no resuelve un problema inmediato) y ruta de emergencia (peligroso sin disponibilidad en tiempo real).

## Diseño conversacional

### Datos que el agente necesita (en este orden)
1. Necesidad: qué le pasa o qué atención busca.
2. Municipio (y departamento solo si el nombre es ambiguo).

Pregunta una sola cosa por turno. Si la persona ya dio un dato, no lo vuelve a pedir.

### Flujo
1. Saludo con la misión en una frase. Si hay documento, menciona de qué trata en una frase.
2. Detección de emergencia en cada turno (no respira, inconsciente, sangrado abundante, dolor de pecho, intento de suicidio, convulsión). Si la hay: "Llama al 123 ahora". Solo después, si la persona lo pide, da sedes con urgencias aclarando que no sabe si hay cupo.
3. Traduce la necesidad a un tipo de atención (tabla abajo). Si la necesidad está entre urgencias y consulta externa, hace una sola pregunta de orientación: "¿Es un dolor fuerte o repentino, o fue un golpe?". Nunca diagnostica.
4. Consulta el registro con la herramienta.
5. Responde por voz con máximo 3 sedes (nombre y dirección) y muestra en pantalla tarjetas con todas (hasta 20) con dirección, teléfono, naturaleza y capacidad.
6. Si no hay sedes en el municipio, lo dice y ofrece las del departamento.
7. Cierra con una pregunta corta: "¿Te doy el teléfono de alguna?" o "¿Necesitas algo más?".

### Necesidad y tipo de atención
| Categoría (enum de la herramienta) | Ejemplos de la persona | Capacidades del registro |
|---|---|---|
| `consulta_general` | Me siento mal, control, la piel, dolor leve | Consulta Externa |
| `urgencias` | Dolor fuerte o súbito, accidente, fiebre alta en bebé | Urgencias (consultorio), Observación |
| `partos` | Embarazo, voy a dar a luz | Partos, TPR, Atención del Parto, Obstetricia |
| `neonatal` | Bebé prematuro o recién nacido grave | Incubadoras y cunas neonatales, Cuidado Intensivo, Intermedio y básico Neonatal |
| `pediatria` | Niño hospitalizado o grave | Pediátrica, Intensiva e Intermedia Pediátrica, Cuidado Intensivo e Intermedio Pediátrico |
| `uci_adultos` | Adulto en cuidados intensivos | Intensiva Adultos, Cuidado Intensivo Adulto, Intermedia Adultos, Cuidado Intermedio Adulto |
| `hospitalizacion` | Hospitalizar a un adulto | Adultos |
| `cirugia` | Operación | Sala de Cirugía, Quirófano |
| `dialisis` | Riñones, diálisis | Sillas de Hemodiálisis |
| `cancer` | Cáncer, quimioterapia, radioterapia | Sillas de Quimioterapia, Sala de Radioterapia, Transplante de progenitores hematopoyeticos |
| `quemados` | Quemaduras | Unidad de Quemados, Intensiva Quemado |
| `salud_mental` | Crisis emocional, psiquiatría | Salud Mental (camas, camillas, sillas), Psiquiatría, Cuidado Agudo Mental |
| `adicciones` | Consumo de sustancias | SPA, Farmacodependencia |
| `ambulancia` | Traslado de un paciente | Ambulancia Básica y Medicalizada |
| `unidad_movil` | Zona rural, brigada | Unidad Móvil |

### Reglas del agente
- Cuando un dato sale del documento, lo cita con "según tu documento". Los datos del registro se dan sin frase de fuente. El corte y que la capacidad no es disponibilidad se dicen una vez por conversación, no en cada respuesta.
- Si algo no está en el documento ni en el registro, responde que no lo sabe. Nunca inventa.
- Especialidades: dice que el registro no las detalla, da las sedes del tipo de atención correspondiente y sugiere confirmar con la EPS.
- Nunca diagnostica, nunca recomienda tratamientos ni medicamentos, nunca dice que una sede es "mejor" que otra.
- Nunca menciona nombres de gerentes ni correos.
- Fuera de la misión: una frase para redirigir ("Puedo ayudarte a encontrar dónde atenderte o a entender tu documento").
- Documento que no es de salud: igual lo resume y responde sobre él con rigor (el jurado lo evalúa); la herramienta solo se usa en preguntas de atención en salud.
- Estilo de voz: frases cortas, sin listas ni formato, máximo dos frases y una pregunta por turno.

## Herramienta `buscar_sedes`

Una sola herramienta. Parámetros: `necesidad` (enum de la tabla), `municipio`, `departamento` opcional, `naturaleza` opcional. El modelo nunca escribe consultas: el servidor traduce el enum a la lista fija de capacidades y construye la consulta con valores escapados.

- El municipio se resuelve contra la lista oficial (1.027 nombres) por el nombre más parecido, sin tildes ni mayúsculas, porque la transcripción deforma nombres ("Letizia" por "Leticia", defecto del paso 1).
- Las columnas pedidas salen de una lista blanca que excluye gerente y email.
- Rarezas del dataset que se manejan: Cali, Barranquilla, Cartagena, Santa Marta y Buenaventura aparecen como departamento; el nivel de atención casi siempre viene vacío.
- Respuesta: municipio resuelto, alcance (municipio o departamento), total de sedes y hasta 20 sedes con nombre, prestador, dirección, teléfono, naturaleza, nivel y capacidades.

## Consecuencias

- El agente es útil y honesto, pero no responde especialidades, EPS, cupos ni horarios. Se acepta y se dice en la demo como límite de los datos públicos.
- Las tarjetas en pantalla suman trabajo de interfaz en el paso 5 o 6.
- Riesgo: un jurado que pregunte por una especialidad recibe "el registro no lo detalla". Mitigación: la respuesta siempre ofrece la alternativa útil (sedes con consulta externa y confirmar con la EPS).
