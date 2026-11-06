---
name: bruff-control
description: Consulta y modifica los ajustes implementados del buscador de ejemplos de BRUFF IA mediante el conector privado, cuando el usuario pida administrar BRUFF desde ChatGPT. Requiere autorización de propietario de BRUFF.
---

# Control privado de BRUFF IA

Usa únicamente las herramientas del servidor bruff-control disponibles en este chat. Comprueba acceso con bruff_list_models. Si faltan herramientas, hay un error de autenticación o no aparece una agencia, informa del estado y usa el flujo oficial de conexión del plugin. No solicites contraseñas, claves ni tokens en el chat.

«Memoria chats 1» es el chat de administración preferido del usuario. El título no autentica a nadie ni limita por sí solo dónde funciona el plugin. La configuración persistente de BRUFF es la autoridad; no supongas que otro chat comparte esta conversación.

Antes de cambiar ajustes, identifica la agencia y la modelo mediante la respuesta real de bruff_list_models. Si la petición es ambigua, pregunta qué modelo corresponde. Consulta bruff_read_ai_settings y conserva los ajustes que el usuario no haya pedido cambiar. Usa la versión actual como expected al llamar bruff_update_ai_settings. Un conflicto exige volver a leer y revisar; no repitas una escritura a ciegas. Confirma únicamente cambios acreditados por el resultado.

Los ajustes controlan la recuperación manual de ejemplos: modo de banco o motor semántico, máximo de opciones, umbral mínimo de relevancia y límite diario. No equivalen a activación de un bot. Tener modo semántico guardado no prueba que haya credenciales, plan gratuito confirmado, corpus aprobado o una consulta real de IA exitosa. Distingue los estados de configuración y ejecución.

Utiliza exclusivamente información documentada. Conserva el original literal y su traducción por separado; nunca inventes una fuente, una conversación, una versión, una compra ni una tercera respuesta para completar opciones. Los ejemplos gestionados por este conector son no explícitos. El motor semántico ordena ejemplos aprobados y no redacta mensajes nuevos.

bruff_list_examples permite revisar el banco. bruff_save_example_draft guarda solo borradores documentales con referencia real y versión. No representa una importación automática de chats, aprobación ni entrenamiento. La revisión y aprobación del propietario se realizan en el CRM. bruff_archive_example requiere que el usuario pida retirar ese ejemplo de las sugerencias; lee y usa su versión actual. Archivar conserva el registro.

Este conector no ofrece envío de mensajes, activación de asistentes, ejecución de campañas, subidas, likes, permisos de trabajadores, configuración de credenciales ni acceso arbitrario a APIs. No intentes realizar esas acciones mediante otros conectores como alternativa. No envíes mensajes al probar el control. No presentes la investigación cada doce horas como sincronizada hasta que exista una ejecución comprobada del proceso correspondiente.
