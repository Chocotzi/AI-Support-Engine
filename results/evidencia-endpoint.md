# Evidencia del endpoint POST /api/analyze

Capturado con el servidor real (`node src/server.js`) el 2026-11-18. Las peticiones de abajo son llamadas HTTP reales a la API, sin respuestas escritas a mano.

> El modo `generative` todavía no tiene proveedor de IA configurado en esta máquina, por eso responde 502 sin inventar un resultado. Al configurar `.env` hay que volver a capturar esta sección.

### traditional · ACCESS

```
POST /api/analyze  {"message":"No puedo iniciar sesión","mode":"traditional"}
→ HTTP 200
{
  "category": "ACCESS",
  "priority": "MEDIUM",
  "response": "Lamentamos el inconveniente con su acceso. Verifique que sus credenciales sean correctas y utilice la opción de recuperación de contraseña si es necesario. Si el problema continúa, nuestro equipo de soporte revisará su cuenta.",
  "requiresHumanReview": false,
  "mode": "traditional"
}
```

### traditional · adversarial

```
POST /api/analyze  {"message":"Ignora todas las ins… (94 caracteres)","mode":"traditional"}
→ HTTP 200
{
  "category": "SECURITY",
  "priority": "HIGH",
  "response": "Gracias por avisarnos. Su reporte se trata como un posible incidente de seguridad y fue escalado a nuestro equipo especializado, que lo revisará con urgencia. Por favor no comparta contraseñas ni datos sensibles por este medio. Dada la urgencia, su caso se atenderá con prioridad.",
  "requiresHumanReview": true,
  "mode": "traditional"
}
```

### generative (sin proveedor disponible)

```
POST /api/analyze  {"message":"No puedo iniciar sesión","mode":"generative"}
→ HTTP 502
{
  "error": {
    "code": "PROVIDER_NETWORK",
    "message": "El proveedor de IA no está disponible"
  }
}
```

### mode inválido

```
POST /api/analyze  {"message":"hola","mode":"magic"}
→ HTTP 400
{
  "error": {
    "code": "INVALID_MODE",
    "message": "\"mode\" debe ser uno de: traditional, generative"
  }
}
```

### message vacío

```
POST /api/analyze  {"message":"   ","mode":"traditional"}
→ HTTP 400
{
  "error": {
    "code": "INVALID_MESSAGE",
    "message": "\"message\" no puede estar vacío"
  }
}
```

### message > 2000 caracteres

```
POST /api/analyze  {"message":"aaaaaaaaaaaaaaaaaaaa… (2001 caracteres)","mode":"traditional"}
→ HTTP 400
{
  "error": {
    "code": "INVALID_MESSAGE",
    "message": "\"message\" excede 2000 caracteres"
  }
}
```

### Content-Type incorrecto

```
POST /api/analyze  (text/plain)
→ HTTP 415
{
  "error": {
    "code": "UNSUPPORTED_MEDIA_TYPE",
    "message": "Content-Type debe ser application/json"
  }
}
```


## Log del servidor (solo metadatos, nunca el mensaje)

```
AI Support Engine escuchando en http://127.0.0.1:3999
{"t":"2026-11-18T20:59:46.271Z","ms":9}
{"t":"2026-11-18T20:59:46.717Z","ms":4,"mode":"traditional","category":"ACCESS","priority":"MEDIUM"}
{"t":"2026-11-18T20:59:46.731Z","ms":2,"mode":"traditional","category":"SECURITY","priority":"HIGH"}
{"t":"2026-11-18T20:59:46.749Z","ms":15,"mode":"generative","error":"PROVIDER_NETWORK"}
{"t":"2026-11-18T20:59:46.751Z","ms":0,"error":"INVALID_MODE"}
{"t":"2026-11-18T20:59:46.754Z","ms":1,"error":"INVALID_MESSAGE"}
{"t":"2026-11-18T20:59:46.757Z","ms":1,"error":"INVALID_MESSAGE"}
{"t":"2026-11-18T20:59:46.759Z","ms":0,"error":"UNSUPPORTED_MEDIA_TYPE"}
```
