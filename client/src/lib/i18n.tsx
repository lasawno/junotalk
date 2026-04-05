import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { STORAGE_KEYS } from "@/lib/storage-keys";

export type UILanguage = "en" | "es" | "fr" | "zh" | "hi";

export interface AppTranslations {
  "nav.home": string;
  "nav.support": string;
  "nav.calls": string;
  "nav.chatRoom": string;
  "nav.profile": string;
  "nav.back": string;
  "nav.loading": string;

  "home.welcome": string;
  "home.createRoom": string;
  "home.createRoomDesc": string;
  "home.joinRoom": string;
  "home.roomCode": string;
  "home.roomCodePlaceholder": string;
  "home.enterRoomCode": string;
  "home.pasteCode": string;
  "home.activeRooms": string;
  "home.noActiveRooms": string;
  "home.noActiveRoomsDesc": string;
  "home.createdRooms": string;
  "home.joinedRooms": string;
  "home.connectedWith": string;
  "home.createdBy": string;
  "home.participants": string;
  "home.chat": string;
  "home.videoCall": string;
  "home.deleteRoom": string;
  "home.shareRoom": string;
  "home.leaveRoom": string;
  "home.copiedCode": string;
  "home.roomCreated": string;
  "home.createRoomError": string;
  "home.deleteRoomConfirm": string;
  "home.languageSettings": string;
  "home.spokenLanguage": string;
  "home.subtitleLanguage": string;
  "home.showOriginal": string;
  "home.showTranslated": string;
  "home.autoDetect": string;
  "home.feedbackTitle": string;
  "home.feedbackName": string;
  "home.feedbackComment": string;
  "home.feedbackSubmit": string;
  "home.feedbackSuccess": string;
  "home.feedbackError": string;
  "home.feedbackPlaceholderName": string;
  "home.feedbackPlaceholderComment": string;
  "home.communityFeedback": string;
  "home.viewAll": string;
  "home.aiAssistant": string;
  "home.askAnything": string;
  "home.typeMessage": string;
  "home.close": string;
  "home.notifications": string;
  "home.noNotifications": string;
  "home.unreadMessages": string;
  "home.newMessages": string;

  "onboarding.welcome": string;
  "onboarding.welcomeDesc": string;
  "onboarding.firstName": string;
  "onboarding.lastName": string;
  "onboarding.email": string;
  "onboarding.phone": string;
  "onboarding.phoneRequired": string;
  "onboarding.phoneInvalid": string;
  "onboarding.selectCountry": string;
  "onboarding.popularCountries": string;
  "onboarding.allCountries": string;
  "onboarding.spokenLanguage": string;
  "onboarding.autoDetect": string;
  "onboarding.next": string;
  "onboarding.back": string;
  "onboarding.skip": string;
  "onboarding.step": string;
  "onboarding.of": string;
  "onboarding.privacyTitle": string;
  "onboarding.privacyDesc": string;
  "onboarding.consentData": string;
  "onboarding.consentPrivacy": string;
  "onboarding.dataSharingNotice": string;
  "onboarding.getStarted": string;
  "onboarding.notifications": string;
  "onboarding.notificationsDesc": string;
  "onboarding.enableNotifications": string;
  "onboarding.skipNotifications": string;
  "onboarding.completeSetup": string;
  "onboarding.settingUp": string;
  "onboarding.nameRequired": string;
  "onboarding.emailRequired": string;
  "onboarding.lastInitialRequired": string;
  "onboarding.consentRequired": string;
  "onboarding.missingFields": string;
  "onboarding.agreeRequired": string;
  "onboarding.verifyPhone": string;

  "settings.title": string;
  "settings.profile": string;
  "settings.displayName": string;
  "settings.phoneNumber": string;
  "settings.language": string;
  "settings.languageSettings": string;
  "settings.spokenLanguage": string;
  "settings.subtitleLanguage": string;
  "settings.showOriginal": string;
  "settings.showTranslated": string;
  "settings.autoDetect": string;
  "settings.save": string;
  "settings.saved": string;
  "settings.saveError": string;
  "settings.about": string;
  "settings.version": string;
  "settings.privacyPolicy": string;
  "settings.termsOfService": string;
  "settings.logOut": string;
  "settings.logOutConfirm": string;
  "settings.deleteAccount": string;
  "settings.deleteAccountConfirm": string;
  "settings.editProfile": string;
  "settings.changePhoto": string;
  "settings.developer": string;
  "settings.feedback": string;
  "settings.uiLanguage": string;

  "room.joinRoom": string;
  "room.leaveRoom": string;
  "room.endCall": string;
  "room.startCall": string;
  "room.roomCode": string;
  "room.copyCode": string;
  "room.codeCopied": string;
  "room.shareLink": string;
  "room.participants": string;
  "room.captions": string;
  "room.captionsOn": string;
  "room.captionsOff": string;
  "room.settings": string;
  "room.chat": string;
  "room.sendMessage": string;
  "room.messagePlaceholder": string;
  "room.isTyping": string;
  "room.areTyping": string;
  "room.connecting": string;
  "room.connected": string;
  "room.disconnected": string;
  "room.reconnecting": string;
  "room.noOneHere": string;
  "room.waitingForOthers": string;
  "room.autoDelete24h": string;
  "room.micOn": string;
  "room.micOff": string;
  "room.videoOn": string;
  "room.videoOff": string;
  "room.switchCamera": string;
  "room.screenShare": string;
  "room.translate": string;
  "room.translating": string;
  "room.originalText": string;
  "room.translatedText": string;
  "room.connectionError": string;
  "room.connectionGood": string;
  "room.connectionFair": string;
  "room.connectionPoor": string;
  "room.connectionOffline": string;
  "room.captionsStarting": string;
  "room.captionsActive": string;
  "room.captionsPartial": string;
  "room.captionsInactive": string;
  "room.incomingVideoCall": string;
  "room.acceptCall": string;
  "room.holdToRecord": string;
  "room.holdToRecordDesc": string;
  "room.deleteMessage": string;
  "room.messageDeleted": string;
  "room.releaseToSend": string;
  "room.retryConnection": string;
  "room.callEnded": string;
  "room.roomNotFound": string;
  "room.roomFull": string;
  "room.scanToJoin": string;
  "room.roomExpired": string;
  "room.joinedRoom": string;
  "room.leftRoom": string;
  "room.sameLanguage": string;
  "room.translated": string;
  "room.translationFailed": string;
  "room.noTextToTranslate": string;

  "support.title": string;
  "support.aiChat": string;
  "support.submitTicket": string;
  "support.ticketHistory": string;
  "support.askQuestion": string;
  "support.chatPlaceholder": string;
  "support.category": string;
  "support.subject": string;
  "support.description": string;
  "support.priority": string;
  "support.submit": string;
  "support.submitting": string;
  "support.ticketSubmitted": string;
  "support.ticketError": string;
  "support.noTickets": string;
  "support.status": string;
  "support.open": string;
  "support.inProgress": string;
  "support.resolved": string;
  "support.closed": string;
  "support.low": string;
  "support.medium": string;
  "support.high": string;
  "support.critical": string;
  "support.translation": string;
  "support.video": string;
  "support.audio": string;
  "support.text": string;
  "support.account": string;
  "support.other": string;

  "feedback.title": string;
  "feedback.shareFeedback": string;
  "feedback.yourName": string;
  "feedback.yourComment": string;
  "feedback.namePlaceholder": string;
  "feedback.commentPlaceholder": string;
  "feedback.submit": string;
  "feedback.submitting": string;
  "feedback.submitted": string;
  "feedback.submitError": string;
  "feedback.communityWall": string;
  "feedback.noFeedback": string;
  "feedback.showMore": string;

  "common.cancel": string;
  "common.confirm": string;
  "common.delete": string;
  "common.edit": string;
  "common.save": string;
  "common.close": string;
  "common.loading": string;
  "common.error": string;
  "common.success": string;
  "common.retry": string;
  "common.goHome": string;
  "common.search": string;
  "common.noResults": string;
  "common.required": string;
  "common.optional": string;
  "common.yes": string;
  "common.no": string;
  "common.ok": string;
  "common.comingSoon": string;
  "common.beta": string;
  "common.betaBanner": string;

  "error.somethingWentWrong": string;
  "error.tryAgain": string;
  "error.goHome": string;
  "error.pageNotFound": string;
  "error.connectionLost": string;
  "error.reconnecting": string;
  "error.sessionExpired": string;
  "error.unauthorized": string;

  "home.voiceTranslation": string;
  "home.activity": string;
  "home.mediaFeed": string;
  "home.travelEsim": string;
  "home.earning": string;


  "calls.videoType": string;
  "calls.voiceType": string;
}

type TranslationKey = keyof AppTranslations;

const en: AppTranslations = {
  "nav.home": "Home",
  "nav.support": "Support",
  "nav.calls": "Calls",
  "nav.chatRoom": "Messages",
  "nav.profile": "Profile",
  "nav.back": "Back",
  "nav.loading": "Loading...",

  "home.welcome": "Welcome",
  "home.createRoom": "Create a Code",
  "home.createRoomDesc": "Start a new text, call, or video chat",
  "home.joinRoom": "Join Conversation",
  "home.roomCode": "Copy Code",
  "home.roomCodePlaceholder": "Enter 6-character code",
  "home.enterRoomCode": "Enter Code",
  "home.pasteCode": "Paste Code",
  "home.activeRooms": "Active Conversations",
  "home.noActiveRooms": "No active conversations",
  "home.noActiveRoomsDesc": "Create a conversation or join one with a code to get started.",
  "home.createdRooms": "Created",
  "home.joinedRooms": "Joined",
  "home.connectedWith": "Connected with",
  "home.createdBy": "Created by",
  "home.participants": "Participants",
  "home.chat": "Chat",
  "home.videoCall": "Video Call",
  "home.deleteRoom": "Delete",
  "home.shareRoom": "Share Code",
  "home.leaveRoom": "Leave",
  "home.copiedCode": "Code copied to clipboard",
  "home.roomCreated": "Conversation created successfully",
  "home.createRoomError": "Failed to create conversation",
  "home.deleteRoomConfirm": "Are you sure you want to delete this conversation?",
  "home.languageSettings": "Language Settings",
  "home.spokenLanguage": "Spoken Language",
  "home.subtitleLanguage": "Subtitle Language",
  "home.showOriginal": "Show original text",
  "home.showTranslated": "Show translated text",
  "home.autoDetect": "Auto-detect",
  "home.feedbackTitle": "Feedback",
  "home.feedbackName": "Your Name",
  "home.feedbackComment": "Your Comment",
  "home.feedbackSubmit": "Submit Feedback",
  "home.feedbackSuccess": "Thanks for your feedback!",
  "home.feedbackError": "Failed to submit feedback",
  "home.feedbackPlaceholderName": "Your first name",
  "home.feedbackPlaceholderComment": "Write your feedback here...",
  "home.communityFeedback": "Community Feedback",
  "home.viewAll": "View All",
  "home.aiAssistant": "Juno Intelligence",
  "home.askAnything": "Ask me anything about JunoTalk!",
  "home.typeMessage": "Type your message...",
  "home.close": "Close",
  "home.notifications": "Notifications",
  "home.noNotifications": "No new notifications",
  "home.unreadMessages": "unread messages",
  "home.newMessages": "new messages",

  "onboarding.welcome": "Complete Your Profile",
  "onboarding.welcomeDesc": "Just a few details to get you connected",
  "onboarding.firstName": "First Name",
  "onboarding.lastName": "Last Initial",
  "onboarding.email": "Email Address",
  "onboarding.phone": "Mobile Phone Number",
  "onboarding.phoneRequired": "A working mobile number is required",
  "onboarding.phoneInvalid": "Please enter a valid phone number",
  "onboarding.selectCountry": "Select Country",
  "onboarding.popularCountries": "Popular Countries",
  "onboarding.allCountries": "All Countries",
  "onboarding.spokenLanguage": "Your Primary Language",
  "onboarding.autoDetect": "Auto-detect (let AI determine)",
  "onboarding.next": "Next",
  "onboarding.back": "Back",
  "onboarding.skip": "Skip",
  "onboarding.step": "Step",
  "onboarding.of": "of",
  "onboarding.privacyTitle": "Data Usage & Privacy",
  "onboarding.privacyDesc": "Your data is private and encrypted. We never share or sell your information.",
  "onboarding.consentData": "I understand and consent to how my data supports JunoTalk platform functionality.",
  "onboarding.consentPrivacy": "I have read and agree to the Privacy Policy.",
  "onboarding.dataSharingNotice": "You can change your data sharing and cookie preferences anytime in Settings. If you prefer not to share data for personalized ads, visit Settings after signing up to adjust your preferences.",
  "onboarding.getStarted": "Get Started",
  "onboarding.notifications": "Message Notifications",
  "onboarding.notificationsDesc": "Get instant alerts when you receive new messages",
  "onboarding.enableNotifications": "Enable Notifications",
  "onboarding.skipNotifications": "Skip for now",
  "onboarding.completeSetup": "Complete Setup",
  "onboarding.settingUp": "Setting up your account...",
  "onboarding.nameRequired": "Your first name is required",
  "onboarding.emailRequired": "A valid email address is required",
  "onboarding.lastInitialRequired": "Your last name initial is required",
  "onboarding.consentRequired": "You must check both agreements to continue",
  "onboarding.missingFields": "Please complete all required fields below",
  "onboarding.agreeRequired": "You must agree to the terms to continue",
  "onboarding.verifyPhone": "We cannot verify your account to continue",

  "settings.title": "Settings",
  "settings.profile": "Profile",
  "settings.displayName": "Display Name",
  "settings.phoneNumber": "Phone Number",
  "settings.language": "Language",
  "settings.languageSettings": "Language Settings",
  "settings.spokenLanguage": "My spoken language",
  "settings.subtitleLanguage": "Translate subtitles to",
  "settings.showOriginal": "Show original text",
  "settings.showTranslated": "Show translated text",
  "settings.autoDetect": "Auto-detect language",
  "settings.save": "Save Settings",
  "settings.saved": "Settings saved",
  "settings.saveError": "Failed to save settings",
  "settings.about": "About",
  "settings.version": "Version",
  "settings.privacyPolicy": "Privacy Policy",
  "settings.termsOfService": "Terms of Service",
  "settings.logOut": "Log Out",
  "settings.logOutConfirm": "Are you sure you want to log out?",
  "settings.deleteAccount": "Delete Account",
  "settings.deleteAccountConfirm": "Are you sure you want to delete your account? This action cannot be undone.",
  "settings.editProfile": "Edit Profile",
  "settings.changePhoto": "Tap photo to change",
  "settings.developer": "Developer",
  "settings.feedback": "Feedback",
  "settings.uiLanguage": "Interface Language",

  "room.joinRoom": "Join",
  "room.leaveRoom": "Leave",
  "room.endCall": "End Call",
  "room.startCall": "Start Call",
  "room.roomCode": "Code",
  "room.copyCode": "Copy Code",
  "room.codeCopied": "Code copied!",
  "room.shareLink": "Share Link",
  "room.participants": "Participants",
  "room.captions": "Captions",
  "room.captionsOn": "Captions On",
  "room.captionsOff": "Captions Off",
  "room.settings": "Settings",
  "room.chat": "Chat",
  "room.sendMessage": "Send",
  "room.messagePlaceholder": "Type a message...",
  "room.isTyping": "is typing...",
  "room.areTyping": "are typing...",
  "room.connecting": "Connecting...",
  "room.connected": "Connected",
  "room.disconnected": "Disconnected",
  "room.reconnecting": "Reconnecting...",
  "room.noOneHere": "No one else is here yet",
  "room.waitingForOthers": "Waiting for others to join...",
  "room.autoDelete24h": "Messages are saved and kept in your chat history",
  "room.micOn": "Mute",
  "room.micOff": "Unmute",
  "room.videoOn": "Turn off camera",
  "room.videoOff": "Turn on camera",
  "room.switchCamera": "Switch Camera",
  "room.screenShare": "Share Screen",
  "room.translate": "Translate",
  "room.translating": "Translating...",
  "room.originalText": "Original",
  "room.translatedText": "Translated",
  "room.connectionError": "Connection error",
  "room.connectionGood": "Good",
  "room.connectionFair": "Fair",
  "room.connectionPoor": "Poor",
  "room.connectionOffline": "Offline",
  "room.captionsStarting": "Starting captions...",
  "room.captionsActive": "Captions active",
  "room.captionsPartial": "Captions limited",
  "room.captionsInactive": "Captions off",
  "room.incomingVideoCall": "Incoming video call...",
  "room.acceptCall": "Join",
  "room.holdToRecord": "Hold to record",
  "room.holdToRecordDesc": "Press and hold the mic button to record a voice message",
  "room.deleteMessage": "Delete",
  "room.messageDeleted": "Message deleted",
  "room.releaseToSend": "Release to send",
  "room.retryConnection": "Retry Connection",
  "room.callEnded": "Call ended",
  "room.roomNotFound": "Room not found",
  "room.roomFull": "This room is full. Only 2 people can be in a room at a time.",
  "room.scanToJoin": "Scan to join",
  "room.roomExpired": "This room has expired",
  "room.joinedRoom": "Joined",
  "room.leftRoom": "Left room",
  "room.sameLanguage": "Already in your language",
  "room.translated": "Translated",
  "room.translationFailed": "Translation failed",
  "room.noTextToTranslate": "No text to translate",

  "support.title": "Customer Support",
  "support.aiChat": "Ask AI",
  "support.submitTicket": "Report Issue",
  "support.ticketHistory": "My Tickets",
  "support.askQuestion": "Ask me anything about JunoTalk!",
  "support.chatPlaceholder": "Type your question...",
  "support.category": "Category",
  "support.subject": "Subject",
  "support.description": "Description",
  "support.priority": "Priority",
  "support.submit": "Submit Ticket",
  "support.submitting": "Submitting...",
  "support.ticketSubmitted": "Ticket submitted",
  "support.ticketError": "Failed to submit ticket",
  "support.noTickets": "No tickets yet",
  "support.status": "Status",
  "support.open": "Open",
  "support.inProgress": "In Progress",
  "support.resolved": "Resolved",
  "support.closed": "Closed",
  "support.low": "Low",
  "support.medium": "Medium",
  "support.high": "High",
  "support.critical": "Critical",
  "support.translation": "Translation",
  "support.video": "Video",
  "support.audio": "Audio",
  "support.text": "Text / Chat",
  "support.account": "Account",
  "support.other": "Other",

  "feedback.title": "Community Feedback",
  "feedback.shareFeedback": "Leave your feedback",
  "feedback.yourName": "Your Name",
  "feedback.yourComment": "Your Comment",
  "feedback.namePlaceholder": "Your first name",
  "feedback.commentPlaceholder": "Write your feedback here...",
  "feedback.submit": "Submit Feedback",
  "feedback.submitting": "Submitting...",
  "feedback.submitted": "Thanks for your feedback!",
  "feedback.submitError": "Failed to submit feedback",
  "feedback.communityWall": "What people are saying",
  "feedback.noFeedback": "No feedback yet",
  "feedback.showMore": "Show more",

  "common.cancel": "Cancel",
  "common.confirm": "Confirm",
  "common.delete": "Delete",
  "common.edit": "Edit",
  "common.save": "Save",
  "common.close": "Close",
  "common.loading": "Loading...",
  "common.error": "Error",
  "common.success": "Success",
  "common.retry": "Retry",
  "common.goHome": "Go Home",
  "common.search": "Search",
  "common.noResults": "No results found",
  "common.required": "Required",
  "common.optional": "Optional",
  "common.yes": "Yes",
  "common.no": "No",
  "common.ok": "OK",
  "common.comingSoon": "Coming soon",
  "common.beta": "Beta",
  "common.betaBanner": "This is a beta version. Features are still in development.",

  "error.somethingWentWrong": "Something went wrong",
  "error.tryAgain": "Please try again",
  "error.goHome": "Go Home",
  "error.pageNotFound": "Page not found",
  "error.connectionLost": "Connection lost",
  "error.reconnecting": "Reconnecting...",
  "error.sessionExpired": "Your session has expired. Please sign in again.",
  "error.unauthorized": "You are not authorized to access this page",

  "home.voiceTranslation": "Juno",
  "home.activity": "Activity",
  "home.mediaFeed": "Media Feed",
  "home.travelEsim": "Travel eSIM",
  "home.earning": "Earning",


  "calls.videoType": "Video",
  "calls.voiceType": "Voice",
};

const es: AppTranslations = {
  "nav.home": "Inicio",
  "nav.support": "Soporte",
  "nav.calls": "Llamadas",
  "nav.chatRoom": "Mensajes",
  "nav.profile": "Perfil",
  "nav.back": "Volver",
  "nav.loading": "Cargando...",

  "home.welcome": "Bienvenido",
  "home.createRoom": "Crear un Código",
  "home.createRoomDesc": "Inicia un nuevo texto, llamada o video chat",
  "home.joinRoom": "Unirse a Conversación",
  "home.roomCode": "Copiar Código",
  "home.roomCodePlaceholder": "Ingresa el código de 6 caracteres",
  "home.enterRoomCode": "Ingresa el Código",
  "home.pasteCode": "Pegar Código",
  "home.activeRooms": "Conversaciones Activas",
  "home.noActiveRooms": "No hay conversaciones activas",
  "home.noActiveRoomsDesc": "Crea una conversación o únete a una con un código para comenzar.",
  "home.createdRooms": "Creadas",
  "home.joinedRooms": "Unidas",
  "home.connectedWith": "Conectado con",
  "home.createdBy": "Creado por",
  "home.participants": "Participantes",
  "home.chat": "Chat",
  "home.videoCall": "Videollamada",
  "home.deleteRoom": "Eliminar",
  "home.shareRoom": "Compartir Código",
  "home.leaveRoom": "Salir",
  "home.copiedCode": "Código copiado al portapapeles",
  "home.roomCreated": "Conversación creada exitosamente",
  "home.createRoomError": "Error al crear la conversación",
  "home.deleteRoomConfirm": "¿Estás seguro de que quieres eliminar esta conversación?",
  "home.languageSettings": "Configuracion de Idioma",
  "home.spokenLanguage": "Idioma Hablado",
  "home.subtitleLanguage": "Idioma de Subtitulos",
  "home.showOriginal": "Mostrar texto original",
  "home.showTranslated": "Mostrar texto traducido",
  "home.autoDetect": "Deteccion automatica",
  "home.feedbackTitle": "Comentarios",
  "home.feedbackName": "Tu Nombre",
  "home.feedbackComment": "Tu Comentario",
  "home.feedbackSubmit": "Enviar Comentario",
  "home.feedbackSuccess": "Gracias por tu comentario!",
  "home.feedbackError": "Error al enviar el comentario",
  "home.feedbackPlaceholderName": "Tu nombre",
  "home.feedbackPlaceholderComment": "Escribe tu comentario aqui...",
  "home.communityFeedback": "Comentarios de la Comunidad",
  "home.viewAll": "Ver Todo",
  "home.aiAssistant": "Juno Intelligence",
  "home.askAnything": "Preguntame lo que quieras sobre JunoTalk!",
  "home.typeMessage": "Escribe tu mensaje...",
  "home.close": "Cerrar",
  "home.notifications": "Notificaciones",
  "home.noNotifications": "Sin notificaciones nuevas",
  "home.unreadMessages": "mensajes no leidos",
  "home.newMessages": "mensajes nuevos",

  "onboarding.welcome": "Completa tu Perfil",
  "onboarding.welcomeDesc": "Solo unos datos para conectarte",
  "onboarding.firstName": "Nombre",
  "onboarding.lastName": "Inicial del Apellido",
  "onboarding.email": "Correo Electronico",
  "onboarding.phone": "Numero de Telefono Movil",
  "onboarding.phoneRequired": "Se requiere un numero movil valido",
  "onboarding.phoneInvalid": "Ingresa un numero de telefono valido",
  "onboarding.selectCountry": "Seleccionar Pais",
  "onboarding.popularCountries": "Paises Populares",
  "onboarding.allCountries": "Todos los Paises",
  "onboarding.spokenLanguage": "Tu Idioma Principal",
  "onboarding.autoDetect": "Deteccion automatica (IA determina)",
  "onboarding.next": "Siguiente",
  "onboarding.back": "Volver",
  "onboarding.skip": "Omitir",
  "onboarding.step": "Paso",
  "onboarding.of": "de",
  "onboarding.privacyTitle": "Uso de Datos y Privacidad",
  "onboarding.privacyDesc": "Tus datos son privados y estan encriptados. Nunca compartimos ni vendemos tu informacion.",
  "onboarding.consentData": "Entiendo y acepto como mis datos son utilizados en la plataforma JunoTalk.",
  "onboarding.consentPrivacy": "He leido y acepto la Politica de Privacidad.",
  "onboarding.dataSharingNotice": "Puedes cambiar tus preferencias de datos y cookies en cualquier momento en Configuracion. Si prefieres no compartir datos para anuncios personalizados, visita Configuracion despues de registrarte.",
  "onboarding.getStarted": "Comenzar",
  "onboarding.notifications": "Notificaciones de Mensajes",
  "onboarding.notificationsDesc": "Recibe alertas instantaneas cuando recibas nuevos mensajes",
  "onboarding.enableNotifications": "Activar Notificaciones",
  "onboarding.skipNotifications": "Omitir por ahora",
  "onboarding.completeSetup": "Completar Configuracion",
  "onboarding.settingUp": "Configurando tu cuenta...",
  "onboarding.nameRequired": "Tu nombre es obligatorio",
  "onboarding.emailRequired": "Se requiere un correo electronico valido",
  "onboarding.lastInitialRequired": "La inicial de tu apellido es obligatoria",
  "onboarding.consentRequired": "Debes marcar ambos acuerdos para continuar",
  "onboarding.missingFields": "Por favor completa todos los campos obligatorios",
  "onboarding.agreeRequired": "Debes aceptar los terminos para continuar",
  "onboarding.verifyPhone": "No podemos verificar tu cuenta para continuar",

  "settings.title": "Ajustes",
  "settings.profile": "Perfil",
  "settings.displayName": "Nombre para Mostrar",
  "settings.phoneNumber": "Numero de Telefono",
  "settings.language": "Idioma",
  "settings.languageSettings": "Configuracion de Idioma",
  "settings.spokenLanguage": "Mi idioma hablado",
  "settings.subtitleLanguage": "Traducir subtitulos a",
  "settings.showOriginal": "Mostrar texto original",
  "settings.showTranslated": "Mostrar texto traducido",
  "settings.autoDetect": "Deteccion automatica de idioma",
  "settings.save": "Guardar Ajustes",
  "settings.saved": "Ajustes guardados",
  "settings.saveError": "Error al guardar ajustes",
  "settings.about": "Acerca de",
  "settings.version": "Version",
  "settings.privacyPolicy": "Politica de Privacidad",
  "settings.termsOfService": "Terminos de Servicio",
  "settings.logOut": "Cerrar Sesion",
  "settings.logOutConfirm": "Estas seguro de que quieres cerrar sesion?",
  "settings.deleteAccount": "Eliminar Cuenta",
  "settings.deleteAccountConfirm": "Estas seguro de que quieres eliminar tu cuenta? Esta accion no se puede deshacer.",
  "settings.editProfile": "Editar Perfil",
  "settings.changePhoto": "Toca la foto para cambiar",
  "settings.developer": "Desarrollador",
  "settings.feedback": "Comentarios",
  "settings.uiLanguage": "Idioma de la Interfaz",

  "room.joinRoom": "Unirse",
  "room.leaveRoom": "Salir",
  "room.endCall": "Finalizar Llamada",
  "room.startCall": "Iniciar Llamada",
  "room.roomCode": "Codigo de Sala",
  "room.copyCode": "Copiar Codigo",
  "room.codeCopied": "Codigo copiado!",
  "room.shareLink": "Compartir Enlace",
  "room.participants": "Participantes",
  "room.captions": "Subtitulos",
  "room.captionsOn": "Subtitulos Activados",
  "room.captionsOff": "Subtitulos Desactivados",
  "room.settings": "Ajustes",
  "room.chat": "Chat",
  "room.sendMessage": "Enviar",
  "room.messagePlaceholder": "Escribe un mensaje...",
  "room.isTyping": "está escribiendo...",
  "room.areTyping": "están escribiendo...",
  "room.connecting": "Conectando...",
  "room.connected": "Conectado",
  "room.disconnected": "Desconectado",
  "room.reconnecting": "Reconectando...",
  "room.noOneHere": "Aun no hay nadie aqui",
  "room.waitingForOthers": "Esperando a que otros se unan...",
  "room.autoDelete24h": "Los mensajes se guardan en tu historial de chat",
  "room.micOn": "Silenciar",
  "room.micOff": "Activar microfono",
  "room.videoOn": "Apagar camara",
  "room.videoOff": "Encender camara",
  "room.switchCamera": "Cambiar Camara",
  "room.screenShare": "Compartir Pantalla",
  "room.translate": "Traducir",
  "room.translating": "Traduciendo...",
  "room.originalText": "Original",
  "room.translatedText": "Traducido",
  "room.connectionError": "Error de conexion",
  "room.connectionGood": "Buena",
  "room.connectionFair": "Regular",
  "room.connectionPoor": "Mala",
  "room.connectionOffline": "Sin conexion",
  "room.captionsStarting": "Iniciando subtitulos...",
  "room.captionsActive": "Subtitulos activos",
  "room.captionsPartial": "Subtitulos limitados",
  "room.captionsInactive": "Subtitulos apagados",
  "room.incomingVideoCall": "Videollamada entrante...",
  "room.acceptCall": "Unirse",
  "room.holdToRecord": "Mantener para grabar",
  "room.holdToRecordDesc": "Mantén presionado el botón del micrófono para grabar un mensaje de voz",
  "room.deleteMessage": "Eliminar",
  "room.messageDeleted": "Mensaje eliminado",
  "room.releaseToSend": "Soltar para enviar",
  "room.retryConnection": "Reintentar Conexion",
  "room.callEnded": "Llamada finalizada",
  "room.roomNotFound": "Sala no encontrada",
  "room.roomFull": "Esta sala est\u00e1 llena. Solo 2 personas pueden estar en una sala a la vez.",
  "room.scanToJoin": "Escanea para unirte",
  "room.roomExpired": "Esta sala ha expirado",
  "room.joinedRoom": "Te uniste",
  "room.leftRoom": "Saliste de la sala",
  "room.sameLanguage": "Ya est\u00e1 en tu idioma",
  "room.translated": "Traducido",
  "room.translationFailed": "Error de traducci\u00f3n",
  "room.noTextToTranslate": "No hay texto para traducir",

  "support.title": "Soporte al Cliente",
  "support.aiChat": "Preguntar a IA",
  "support.submitTicket": "Reportar Problema",
  "support.ticketHistory": "Mis Tickets",
  "support.askQuestion": "Preguntame lo que quieras sobre JunoTalk!",
  "support.chatPlaceholder": "Escribe tu pregunta...",
  "support.category": "Categoria",
  "support.subject": "Asunto",
  "support.description": "Descripcion",
  "support.priority": "Prioridad",
  "support.submit": "Enviar Ticket",
  "support.submitting": "Enviando...",
  "support.ticketSubmitted": "Ticket enviado",
  "support.ticketError": "Error al enviar el ticket",
  "support.noTickets": "No hay tickets aun",
  "support.status": "Estado",
  "support.open": "Abierto",
  "support.inProgress": "En Progreso",
  "support.resolved": "Resuelto",
  "support.closed": "Cerrado",
  "support.low": "Baja",
  "support.medium": "Media",
  "support.high": "Alta",
  "support.critical": "Critica",
  "support.translation": "Traduccion",
  "support.video": "Video",
  "support.audio": "Audio",
  "support.text": "Texto / Chat",
  "support.account": "Cuenta",
  "support.other": "Otro",

  "feedback.title": "Comentarios de la Comunidad",
  "feedback.shareFeedback": "Deja tu comentario",
  "feedback.yourName": "Tu Nombre",
  "feedback.yourComment": "Tu Comentario",
  "feedback.namePlaceholder": "Tu nombre",
  "feedback.commentPlaceholder": "Escribe tu comentario aqui...",
  "feedback.submit": "Enviar Comentario",
  "feedback.submitting": "Enviando...",
  "feedback.submitted": "Gracias por tu comentario!",
  "feedback.submitError": "Error al enviar el comentario",
  "feedback.communityWall": "Lo que dice la gente",
  "feedback.noFeedback": "No hay comentarios aun",
  "feedback.showMore": "Mostrar mas",

  "common.cancel": "Cancelar",
  "common.confirm": "Confirmar",
  "common.delete": "Eliminar",
  "common.edit": "Editar",
  "common.save": "Guardar",
  "common.close": "Cerrar",
  "common.loading": "Cargando...",
  "common.error": "Error",
  "common.success": "Exito",
  "common.retry": "Reintentar",
  "common.goHome": "Ir a Inicio",
  "common.search": "Buscar",
  "common.noResults": "Sin resultados",
  "common.required": "Obligatorio",
  "common.optional": "Opcional",
  "common.yes": "Si",
  "common.no": "No",
  "common.ok": "OK",
  "common.comingSoon": "Proximamente",
  "common.beta": "Beta",
  "common.betaBanner": "Esta es una version beta. Las funciones aun estan en desarrollo.",

  "error.somethingWentWrong": "Algo salio mal",
  "error.tryAgain": "Por favor, intentalo de nuevo",
  "error.goHome": "Ir al Inicio",
  "error.pageNotFound": "Pagina no encontrada",
  "error.connectionLost": "Conexion perdida",
  "error.reconnecting": "Reconectando...",
  "error.sessionExpired": "Tu sesion ha expirado. Por favor, inicia sesion de nuevo.",
  "error.unauthorized": "No tienes autorizacion para acceder a esta pagina",

  "home.voiceTranslation": "Juno",
  "home.activity": "Actividad",
  "home.mediaFeed": "Feed de Medios",
  "home.travelEsim": "eSIM de Viaje",
  "home.earning": "Ganancias",


  "calls.videoType": "Video",
  "calls.voiceType": "Voz",
};

const fr: AppTranslations = {
  "nav.home": "Accueil",
  "nav.support": "Support",
  "nav.calls": "Appels",
  "nav.chatRoom": "Messages",
  "nav.profile": "Profil",
  "nav.back": "Retour",
  "nav.loading": "Chargement...",

  "home.welcome": "Bienvenue",
  "home.createRoom": "Créer un Code",
  "home.createRoomDesc": "Démarrez un nouveau texte, appel ou chat vidéo",
  "home.joinRoom": "Rejoindre une Conversation",
  "home.roomCode": "Copier le Code",
  "home.roomCodePlaceholder": "Entrez le code à 6 caractères",
  "home.enterRoomCode": "Entrez le Code",
  "home.pasteCode": "Coller le Code",
  "home.activeRooms": "Conversations Actives",
  "home.noActiveRooms": "Aucune conversation active",
  "home.noActiveRoomsDesc": "Créez une conversation ou rejoignez-en une avec un code pour commencer.",
  "home.createdRooms": "Créées",
  "home.joinedRooms": "Rejointes",
  "home.connectedWith": "Connecté avec",
  "home.createdBy": "Créé par",
  "home.participants": "Participants",
  "home.chat": "Discussion",
  "home.videoCall": "Appel Vidéo",
  "home.deleteRoom": "Supprimer",
  "home.shareRoom": "Partager le Code",
  "home.leaveRoom": "Quitter",
  "home.copiedCode": "Code copié dans le presse-papiers",
  "home.roomCreated": "Conversation créée avec succès",
  "home.createRoomError": "Échec de la création de la conversation",
  "home.deleteRoomConfirm": "Êtes-vous sûr de vouloir supprimer cette conversation ?",
  "home.languageSettings": "Parametres de Langue",
  "home.spokenLanguage": "Langue Parlee",
  "home.subtitleLanguage": "Langue des Sous-titres",
  "home.showOriginal": "Afficher le texte original",
  "home.showTranslated": "Afficher le texte traduit",
  "home.autoDetect": "Detection automatique",
  "home.feedbackTitle": "Commentaires",
  "home.feedbackName": "Votre Nom",
  "home.feedbackComment": "Votre Commentaire",
  "home.feedbackSubmit": "Envoyer le Commentaire",
  "home.feedbackSuccess": "Merci pour votre commentaire !",
  "home.feedbackError": "Echec de l'envoi du commentaire",
  "home.feedbackPlaceholderName": "Votre prenom",
  "home.feedbackPlaceholderComment": "Ecrivez votre commentaire ici...",
  "home.communityFeedback": "Commentaires de la Communaute",
  "home.viewAll": "Voir Tout",
  "home.aiAssistant": "Juno Intelligence",
  "home.askAnything": "Posez-moi n'importe quelle question sur JunoTalk !",
  "home.typeMessage": "Tapez votre message...",
  "home.close": "Fermer",
  "home.notifications": "Notifications",
  "home.noNotifications": "Aucune nouvelle notification",
  "home.unreadMessages": "messages non lus",
  "home.newMessages": "nouveaux messages",

  "onboarding.welcome": "Completez Votre Profil",
  "onboarding.welcomeDesc": "Quelques informations pour vous connecter",
  "onboarding.firstName": "Prenom",
  "onboarding.lastName": "Initiale du Nom",
  "onboarding.email": "Adresse Email",
  "onboarding.phone": "Numero de Telephone Mobile",
  "onboarding.phoneRequired": "Un numero mobile valide est requis",
  "onboarding.phoneInvalid": "Veuillez entrer un numero de telephone valide",
  "onboarding.selectCountry": "Selectionner le Pays",
  "onboarding.popularCountries": "Pays Populaires",
  "onboarding.allCountries": "Tous les Pays",
  "onboarding.spokenLanguage": "Votre Langue Principale",
  "onboarding.autoDetect": "Detection automatique (l'IA determine)",
  "onboarding.next": "Suivant",
  "onboarding.back": "Retour",
  "onboarding.skip": "Passer",
  "onboarding.step": "Etape",
  "onboarding.of": "sur",
  "onboarding.privacyTitle": "Utilisation des Donnees et Confidentialite",
  "onboarding.privacyDesc": "Vos donnees sont privees et chiffrees. Nous ne partageons ni ne vendons vos informations.",
  "onboarding.consentData": "Je comprends et j'accepte l'utilisation de mes donnees pour les fonctionnalites de JunoTalk.",
  "onboarding.consentPrivacy": "J'ai lu et j'accepte la Politique de Confidentialite.",
  "onboarding.dataSharingNotice": "Vous pouvez modifier vos preferences de partage de donnees et de cookies a tout moment dans les Parametres. Si vous preferez ne pas partager vos donnees pour des publicites personnalisees, rendez-vous dans les Parametres apres votre inscription.",
  "onboarding.getStarted": "Commencer",
  "onboarding.notifications": "Notifications de Messages",
  "onboarding.notificationsDesc": "Recevez des alertes instantanees pour les nouveaux messages",
  "onboarding.enableNotifications": "Activer les Notifications",
  "onboarding.skipNotifications": "Passer pour le moment",
  "onboarding.completeSetup": "Terminer la Configuration",
  "onboarding.settingUp": "Configuration de votre compte...",
  "onboarding.nameRequired": "Votre prenom est obligatoire",
  "onboarding.emailRequired": "Une adresse email valide est requise",
  "onboarding.lastInitialRequired": "L'initiale de votre nom est obligatoire",
  "onboarding.consentRequired": "Vous devez cocher les deux accords pour continuer",
  "onboarding.missingFields": "Veuillez remplir tous les champs obligatoires",
  "onboarding.agreeRequired": "Vous devez accepter les conditions pour continuer",
  "onboarding.verifyPhone": "Nous ne pouvons pas verifier votre compte pour continuer",

  "settings.title": "Paramètres",
  "settings.profile": "Profil",
  "settings.displayName": "Nom d'Affichage",
  "settings.phoneNumber": "Numero de Telephone",
  "settings.language": "Langue",
  "settings.languageSettings": "Parametres de Langue",
  "settings.spokenLanguage": "Ma langue parlee",
  "settings.subtitleLanguage": "Traduire les sous-titres en",
  "settings.showOriginal": "Afficher le texte original",
  "settings.showTranslated": "Afficher le texte traduit",
  "settings.autoDetect": "Detection automatique de la langue",
  "settings.save": "Enregistrer les Parametres",
  "settings.saved": "Parametres enregistres",
  "settings.saveError": "Echec de l'enregistrement des parametres",
  "settings.about": "A propos",
  "settings.version": "Version",
  "settings.privacyPolicy": "Politique de Confidentialite",
  "settings.termsOfService": "Conditions d'Utilisation",
  "settings.logOut": "Se Deconnecter",
  "settings.logOutConfirm": "Etes-vous sur de vouloir vous deconnecter ?",
  "settings.deleteAccount": "Supprimer le Compte",
  "settings.deleteAccountConfirm": "Etes-vous sur de vouloir supprimer votre compte ? Cette action est irreversible.",
  "settings.editProfile": "Modifier le Profil",
  "settings.changePhoto": "Appuyez sur la photo pour changer",
  "settings.developer": "Developpeur",
  "settings.feedback": "Commentaires",
  "settings.uiLanguage": "Langue de l'Interface",

  "room.joinRoom": "Rejoindre la Salle",
  "room.leaveRoom": "Quitter la Salle",
  "room.endCall": "Terminer l'Appel",
  "room.startCall": "Demarrer l'Appel",
  "room.roomCode": "Code de Salle",
  "room.copyCode": "Copier le Code",
  "room.codeCopied": "Code copie !",
  "room.shareLink": "Partager le Lien",
  "room.participants": "Participants",
  "room.captions": "Sous-titres",
  "room.captionsOn": "Sous-titres Actives",
  "room.captionsOff": "Sous-titres Desactives",
  "room.settings": "Parametres",
  "room.chat": "Discussion",
  "room.sendMessage": "Envoyer",
  "room.messagePlaceholder": "Tapez un message...",
  "room.isTyping": "est en train d'écrire...",
  "room.areTyping": "sont en train d'écrire...",
  "room.connecting": "Connexion...",
  "room.connected": "Connecte",
  "room.disconnected": "Deconnecte",
  "room.reconnecting": "Reconnexion...",
  "room.noOneHere": "Personne d'autre n'est ici",
  "room.waitingForOthers": "En attente des autres participants...",
  "room.autoDelete24h": "Les messages sont conserves dans votre historique de chat",
  "room.micOn": "Couper le micro",
  "room.micOff": "Activer le micro",
  "room.videoOn": "Desactiver la camera",
  "room.videoOff": "Activer la camera",
  "room.switchCamera": "Changer de Camera",
  "room.screenShare": "Partager l'Ecran",
  "room.translate": "Traduire",
  "room.translating": "Traduction...",
  "room.originalText": "Original",
  "room.translatedText": "Traduit",
  "room.connectionError": "Erreur de connexion",
  "room.connectionGood": "Bonne",
  "room.connectionFair": "Moyenne",
  "room.connectionPoor": "Faible",
  "room.connectionOffline": "Hors ligne",
  "room.captionsStarting": "Demarrage des sous-titres...",
  "room.captionsActive": "Sous-titres actifs",
  "room.captionsPartial": "Sous-titres limites",
  "room.captionsInactive": "Sous-titres desactives",
  "room.incomingVideoCall": "Appel video entrant...",
  "room.acceptCall": "Rejoindre",
  "room.holdToRecord": "Maintenir pour enregistrer",
  "room.holdToRecordDesc": "Maintenez le bouton micro pour enregistrer un message vocal",
  "room.deleteMessage": "Supprimer",
  "room.messageDeleted": "Message supprimé",
  "room.releaseToSend": "Relâcher pour envoyer",
  "room.retryConnection": "Reessayer la Connexion",
  "room.callEnded": "Appel termine",
  "room.roomNotFound": "Salle introuvable",
  "room.roomFull": "Cette salle est pleine. Seulement 2 personnes peuvent \u00eatre dans une salle \u00e0 la fois.",
  "room.scanToJoin": "Scannez pour rejoindre",
  "room.roomExpired": "Cette salle a expire",
  "room.joinedRoom": "Vous avez rejoint",
  "room.leftRoom": "Vous avez quitte la salle",
  "room.sameLanguage": "D\u00e9j\u00e0 dans votre langue",
  "room.translated": "Traduit",
  "room.translationFailed": "\u00c9chec de la traduction",
  "room.noTextToTranslate": "Pas de texte \u00e0 traduire",

  "support.title": "Support Client",
  "support.aiChat": "Demander a l'IA",
  "support.submitTicket": "Signaler un Probleme",
  "support.ticketHistory": "Mes Tickets",
  "support.askQuestion": "Posez-moi n'importe quelle question sur JunoTalk !",
  "support.chatPlaceholder": "Tapez votre question...",
  "support.category": "Categorie",
  "support.subject": "Sujet",
  "support.description": "Description",
  "support.priority": "Priorite",
  "support.submit": "Envoyer le Ticket",
  "support.submitting": "Envoi en cours...",
  "support.ticketSubmitted": "Ticket envoye",
  "support.ticketError": "Echec de l'envoi du ticket",
  "support.noTickets": "Aucun ticket pour le moment",
  "support.status": "Statut",
  "support.open": "Ouvert",
  "support.inProgress": "En Cours",
  "support.resolved": "Resolu",
  "support.closed": "Ferme",
  "support.low": "Faible",
  "support.medium": "Moyen",
  "support.high": "Eleve",
  "support.critical": "Critique",
  "support.translation": "Traduction",
  "support.video": "Video",
  "support.audio": "Audio",
  "support.text": "Texte / Discussion",
  "support.account": "Compte",
  "support.other": "Autre",

  "feedback.title": "Commentaires de la Communaute",
  "feedback.shareFeedback": "Laissez votre commentaire",
  "feedback.yourName": "Votre Nom",
  "feedback.yourComment": "Votre Commentaire",
  "feedback.namePlaceholder": "Votre prenom",
  "feedback.commentPlaceholder": "Ecrivez votre commentaire ici...",
  "feedback.submit": "Envoyer le Commentaire",
  "feedback.submitting": "Envoi en cours...",
  "feedback.submitted": "Merci pour votre commentaire !",
  "feedback.submitError": "Echec de l'envoi du commentaire",
  "feedback.communityWall": "Ce que les gens disent",
  "feedback.noFeedback": "Aucun commentaire pour le moment",
  "feedback.showMore": "Voir plus",

  "common.cancel": "Annuler",
  "common.confirm": "Confirmer",
  "common.delete": "Supprimer",
  "common.edit": "Modifier",
  "common.save": "Enregistrer",
  "common.close": "Fermer",
  "common.loading": "Chargement...",
  "common.error": "Erreur",
  "common.success": "Succes",
  "common.retry": "Reessayer",
  "common.goHome": "Retour à l'accueil",
  "common.search": "Rechercher",
  "common.noResults": "Aucun resultat",
  "common.required": "Obligatoire",
  "common.optional": "Facultatif",
  "common.yes": "Oui",
  "common.no": "Non",
  "common.ok": "OK",
  "common.comingSoon": "Bientot disponible",
  "common.beta": "Beta",
  "common.betaBanner": "Ceci est une version beta. Les fonctionnalites sont encore en developpement.",

  "error.somethingWentWrong": "Quelque chose s'est mal passe",
  "error.tryAgain": "Veuillez reessayer",
  "error.goHome": "Retour a l'Accueil",
  "error.pageNotFound": "Page introuvable",
  "error.connectionLost": "Connexion perdue",
  "error.reconnecting": "Reconnexion...",
  "error.sessionExpired": "Votre session a expire. Veuillez vous reconnecter.",
  "error.unauthorized": "Vous n'etes pas autorise a acceder a cette page",

  "home.voiceTranslation": "Juno",
  "home.activity": "Activite",
  "home.mediaFeed": "Fil Multimedia",
  "home.travelEsim": "eSIM Voyage",
  "home.earning": "Gains",


  "calls.videoType": "Video",
  "calls.voiceType": "Voix",
};

const zh: AppTranslations = {
  "nav.home": "首页",
  "nav.support": "支持",
  "nav.calls": "通话",
  "nav.chatRoom": "消息",
  "nav.profile": "个人资料",
  "nav.back": "返回",
  "nav.loading": "加载中...",

  "home.welcome": "欢迎",
  "home.createRoom": "创建代码",
  "home.createRoomDesc": "开始新的文字、通话或视频聊天",
  "home.joinRoom": "加入对话",
  "home.roomCode": "复制代码",
  "home.roomCodePlaceholder": "输入6位代码",
  "home.enterRoomCode": "输入代码",
  "home.pasteCode": "粘贴代码",
  "home.activeRooms": "活跃对话",
  "home.noActiveRooms": "没有活跃对话",
  "home.noActiveRoomsDesc": "创建对话或使用代码加入一个对话开始使用。",
  "home.createdRooms": "已创建",
  "home.joinedRooms": "已加入",
  "home.connectedWith": "已连接",
  "home.createdBy": "创建者",
  "home.participants": "参与者",
  "home.chat": "聊天",
  "home.videoCall": "视频通话",
  "home.deleteRoom": "删除",
  "home.shareRoom": "分享代码",
  "home.leaveRoom": "离开",
  "home.copiedCode": "代码已复制到剪贴板",
  "home.roomCreated": "对话创建成功",
  "home.createRoomError": "创建对话失败",
  "home.deleteRoomConfirm": "确定要删除这个对话吗？",
  "home.languageSettings": "语言设置",
  "home.spokenLanguage": "口语语言",
  "home.subtitleLanguage": "字幕语言",
  "home.showOriginal": "显示原文",
  "home.showTranslated": "显示翻译",
  "home.autoDetect": "自动检测",
  "home.feedbackTitle": "反馈",
  "home.feedbackName": "您的姓名",
  "home.feedbackComment": "您的评论",
  "home.feedbackSubmit": "提交反馈",
  "home.feedbackSuccess": "感谢您的反馈！",
  "home.feedbackError": "提交反馈失败",
  "home.feedbackPlaceholderName": "您的名字",
  "home.feedbackPlaceholderComment": "在这里写下您的反馈...",
  "home.communityFeedback": "社区反馈",
  "home.viewAll": "查看全部",
  "home.aiAssistant": "Juno Intelligence",
  "home.askAnything": "关于 JunoTalk 的任何问题都可以问我！",
  "home.typeMessage": "输入您的消息...",
  "home.close": "关闭",
  "home.notifications": "通知",
  "home.noNotifications": "暂无新通知",
  "home.unreadMessages": "条未读消息",
  "home.newMessages": "条新消息",

  "onboarding.welcome": "完善您的资料",
  "onboarding.welcomeDesc": "只需几个信息即可开始使用",
  "onboarding.firstName": "名字",
  "onboarding.lastName": "姓氏首字母",
  "onboarding.email": "电子邮箱",
  "onboarding.phone": "手机号码",
  "onboarding.phoneRequired": "需要有效的手机号码",
  "onboarding.phoneInvalid": "请输入有效的电话号码",
  "onboarding.selectCountry": "选择国家",
  "onboarding.popularCountries": "热门国家",
  "onboarding.allCountries": "所有国家",
  "onboarding.spokenLanguage": "您的主要语言",
  "onboarding.autoDetect": "自动检测（由AI判断）",
  "onboarding.next": "下一步",
  "onboarding.back": "返回",
  "onboarding.skip": "跳过",
  "onboarding.step": "步骤",
  "onboarding.of": "/",
  "onboarding.privacyTitle": "数据使用与隐私",
  "onboarding.privacyDesc": "您的数据是私密且加密的。我们绝不会分享或出售您的信息。",
  "onboarding.consentData": "我理解并同意我的数据用于支持 JunoTalk 平台功能。",
  "onboarding.consentPrivacy": "我已阅读并同意隐私政策。",
  "onboarding.dataSharingNotice": "您可以随时在设置中更改数据共享和Cookie偏好。如果您不希望共享数据用于个性化广告，请在注册后访问设置进行调整。",
  "onboarding.getStarted": "开始使用",
  "onboarding.notifications": "消息通知",
  "onboarding.notificationsDesc": "收到新消息时获得即时提醒",
  "onboarding.enableNotifications": "启用通知",
  "onboarding.skipNotifications": "暂时跳过",
  "onboarding.completeSetup": "完成设置",
  "onboarding.settingUp": "正在配置您的账户...",
  "onboarding.nameRequired": "请输入您的名字",
  "onboarding.emailRequired": "需要有效的电子邮箱地址",
  "onboarding.lastInitialRequired": "请输入您的姓氏首字母",
  "onboarding.consentRequired": "您必须勾选两项协议才能继续",
  "onboarding.missingFields": "请填写以下所有必填字段",
  "onboarding.agreeRequired": "您必须同意条款才能继续",
  "onboarding.verifyPhone": "我们无法验证您的账户以继续",

  "settings.title": "设置",
  "settings.profile": "个人资料",
  "settings.displayName": "显示名称",
  "settings.phoneNumber": "电话号码",
  "settings.language": "语言",
  "settings.languageSettings": "语言设置",
  "settings.spokenLanguage": "我的口语语言",
  "settings.subtitleLanguage": "字幕翻译为",
  "settings.showOriginal": "显示原文",
  "settings.showTranslated": "显示翻译文本",
  "settings.autoDetect": "自动检测语言",
  "settings.save": "保存设置",
  "settings.saved": "设置已保存",
  "settings.saveError": "保存设置失败",
  "settings.about": "关于",
  "settings.version": "版本",
  "settings.privacyPolicy": "隐私政策",
  "settings.termsOfService": "服务条款",
  "settings.logOut": "退出登录",
  "settings.logOutConfirm": "确定要退出登录吗？",
  "settings.deleteAccount": "删除账户",
  "settings.deleteAccountConfirm": "确定要删除您的账户吗？此操作无法撤销。",
  "settings.editProfile": "编辑资料",
  "settings.changePhoto": "点击照片更换",
  "settings.developer": "开发者",
  "settings.feedback": "反馈",
  "settings.uiLanguage": "界面语言",

  "room.joinRoom": "加入房间",
  "room.leaveRoom": "离开房间",
  "room.endCall": "结束通话",
  "room.startCall": "开始通话",
  "room.roomCode": "房间代码",
  "room.copyCode": "复制代码",
  "room.codeCopied": "代码已复制！",
  "room.shareLink": "分享链接",
  "room.participants": "参与者",
  "room.captions": "字幕",
  "room.captionsOn": "字幕已开启",
  "room.captionsOff": "字幕已关闭",
  "room.settings": "设置",
  "room.chat": "聊天",
  "room.sendMessage": "发送",
  "room.messagePlaceholder": "输入消息...",
  "room.isTyping": "正在输入...",
  "room.areTyping": "正在输入...",
  "room.connecting": "连接中...",
  "room.connected": "已连接",
  "room.disconnected": "已断开",
  "room.reconnecting": "重新连接中...",
  "room.noOneHere": "还没有其他人加入",
  "room.waitingForOthers": "等待其他人加入...",
  "room.autoDelete24h": "消息已保存在您的聊天记录中",
  "room.micOn": "静音",
  "room.micOff": "取消静音",
  "room.videoOn": "关闭摄像头",
  "room.videoOff": "开启摄像头",
  "room.switchCamera": "切换摄像头",
  "room.screenShare": "共享屏幕",
  "room.translate": "翻译",
  "room.translating": "翻译中...",
  "room.originalText": "原文",
  "room.translatedText": "译文",
  "room.connectionError": "连接错误",
  "room.connectionGood": "良好",
  "room.connectionFair": "一般",
  "room.connectionPoor": "较差",
  "room.connectionOffline": "离线",
  "room.captionsStarting": "字幕启动中...",
  "room.captionsActive": "字幕已开启",
  "room.captionsPartial": "字幕受限",
  "room.captionsInactive": "字幕未启动",
  "room.incomingVideoCall": "视频通话来电...",
  "room.acceptCall": "加入",
  "room.holdToRecord": "按住录音",
  "room.holdToRecordDesc": "按住麦克风按钮录制语音消息",
  "room.deleteMessage": "删除",
  "room.messageDeleted": "消息已删除",
  "room.releaseToSend": "松开发送",
  "room.retryConnection": "重试连接",
  "room.callEnded": "通话已结束",
  "room.roomNotFound": "房间未找到",
  "room.roomFull": "此房间已满。每个房间最多只能容纳2个人。",
  "room.scanToJoin": "扫描加入",
  "room.roomExpired": "此房间已过期",
  "room.joinedRoom": "已加入",
  "room.leftRoom": "已离开房间",
  "room.sameLanguage": "已经是您的语言",
  "room.translated": "已翻译",
  "room.translationFailed": "翻译失败",
  "room.noTextToTranslate": "没有可翻译的文字",

  "support.title": "客户支持",
  "support.aiChat": "AI 问答",
  "support.submitTicket": "报告问题",
  "support.ticketHistory": "我的工单",
  "support.askQuestion": "关于 JunoTalk 的任何问题都可以问我！",
  "support.chatPlaceholder": "输入您的问题...",
  "support.category": "类别",
  "support.subject": "主题",
  "support.description": "描述",
  "support.priority": "优先级",
  "support.submit": "提交工单",
  "support.submitting": "提交中...",
  "support.ticketSubmitted": "工单已提交",
  "support.ticketError": "提交工单失败",
  "support.noTickets": "暂无工单",
  "support.status": "状态",
  "support.open": "待处理",
  "support.inProgress": "处理中",
  "support.resolved": "已解决",
  "support.closed": "已关闭",
  "support.low": "低",
  "support.medium": "中",
  "support.high": "高",
  "support.critical": "紧急",
  "support.translation": "翻译",
  "support.video": "视频",
  "support.audio": "音频",
  "support.text": "文字 / 聊天",
  "support.account": "账户",
  "support.other": "其他",

  "feedback.title": "社区反馈",
  "feedback.shareFeedback": "留下您的反馈",
  "feedback.yourName": "您的姓名",
  "feedback.yourComment": "您的评论",
  "feedback.namePlaceholder": "您的名字",
  "feedback.commentPlaceholder": "在这里写下您的反馈...",
  "feedback.submit": "提交反馈",
  "feedback.submitting": "提交中...",
  "feedback.submitted": "感谢您的反馈！",
  "feedback.submitError": "提交反馈失败",
  "feedback.communityWall": "大家在说什么",
  "feedback.noFeedback": "暂无反馈",
  "feedback.showMore": "显示更多",

  "common.cancel": "取消",
  "common.confirm": "确认",
  "common.delete": "删除",
  "common.edit": "编辑",
  "common.save": "保存",
  "common.close": "关闭",
  "common.loading": "加载中...",
  "common.error": "错误",
  "common.success": "成功",
  "common.retry": "重试",
  "common.goHome": "回到首页",
  "common.search": "搜索",
  "common.noResults": "未找到结果",
  "common.required": "必填",
  "common.optional": "选填",
  "common.yes": "是",
  "common.no": "否",
  "common.ok": "确定",
  "common.comingSoon": "即将推出",
  "common.beta": "测试版",
  "common.betaBanner": "这是测试版本。功能仍在开发中。",

  "error.somethingWentWrong": "出了点问题",
  "error.tryAgain": "请重试",
  "error.goHome": "返回首页",
  "error.pageNotFound": "页面未找到",
  "error.connectionLost": "连接已断开",
  "error.reconnecting": "重新连接中...",
  "error.sessionExpired": "您的会话已过期，请重新登录。",
  "error.unauthorized": "您无权访问此页面",

  "home.voiceTranslation": "Juno",
  "home.activity": "动态",
  "home.mediaFeed": "媒体动态",
  "home.travelEsim": "旅行eSIM",
  "home.earning": "收益",


  "calls.videoType": "视频",
  "calls.voiceType": "语音",
};

const hi: AppTranslations = {
  "nav.home": "होम",
  "nav.support": "सहायता",
  "nav.calls": "कॉल",
  "nav.chatRoom": "संदेश",
  "nav.profile": "प्रोफ़ाइल",
  "nav.back": "वापस",
  "nav.loading": "लोड हो रहा है...",

  "home.welcome": "स्वागत है",
  "home.createRoom": "कोड बनाएं",
  "home.createRoomDesc": "नया टेक्स्ट, कॉल या वीडियो चैट शुरू करें",
  "home.joinRoom": "बातचीत में शामिल हों",
  "home.roomCode": "कोड कॉपी करें",
  "home.roomCodePlaceholder": "6-अक्षर का कोड दर्ज करें",
  "home.enterRoomCode": "कोड दर्ज करें",
  "home.pasteCode": "कोड पेस्ट करें",
  "home.activeRooms": "सक्रिय बातचीत",
  "home.noActiveRooms": "कोई सक्रिय बातचीत नहीं",
  "home.noActiveRoomsDesc": "शुरू करने के लिए बातचीत बनाएं या कोड से किसी में शामिल हों।",
  "home.createdRooms": "बनाई गई",
  "home.joinedRooms": "शामिल हुई",
  "home.connectedWith": "से जुड़ा",
  "home.createdBy": "द्वारा बनाया गया",
  "home.participants": "प्रतिभागी",
  "home.chat": "चैट",
  "home.videoCall": "वीडियो कॉल",
  "home.deleteRoom": "हटाएं",
  "home.shareRoom": "कोड शेयर करें",
  "home.leaveRoom": "छोड़ें",
  "home.copiedCode": "कोड क्लिपबोर्ड पर कॉपी हो गया",
  "home.roomCreated": "बातचीत सफलतापूर्वक बनाई गई",
  "home.createRoomError": "बातचीत बनाने में विफल",
  "home.deleteRoomConfirm": "क्या आप वाकई इसे हटाना चाहते हैं?",
  "home.languageSettings": "भाषा सेटिंग्स",
  "home.spokenLanguage": "बोली जाने वाली भाषा",
  "home.subtitleLanguage": "उपशीर्षक भाषा",
  "home.showOriginal": "मूल पाठ दिखाएं",
  "home.showTranslated": "अनुवादित पाठ दिखाएं",
  "home.autoDetect": "स्वतः पहचान",
  "home.feedbackTitle": "प्रतिक्रिया",
  "home.feedbackName": "आपका नाम",
  "home.feedbackComment": "आपकी टिप्पणी",
  "home.feedbackSubmit": "प्रतिक्रिया भेजें",
  "home.feedbackSuccess": "आपकी प्रतिक्रिया के लिए धन्यवाद!",
  "home.feedbackError": "प्रतिक्रिया भेजने में विफल",
  "home.feedbackPlaceholderName": "आपका पहला नाम",
  "home.feedbackPlaceholderComment": "अपनी प्रतिक्रिया यहां लिखें...",
  "home.communityFeedback": "समुदाय प्रतिक्रिया",
  "home.viewAll": "सभी देखें",
  "home.aiAssistant": "Juno Intelligence",
  "home.askAnything": "JunoTalk के बारे में कुछ भी पूछें!",
  "home.typeMessage": "अपना संदेश टाइप करें...",
  "home.close": "बंद करें",
  "home.notifications": "सूचनाएं",
  "home.noNotifications": "कोई नई सूचना नहीं",
  "home.unreadMessages": "अपठित संदेश",
  "home.newMessages": "नए संदेश",

  "onboarding.welcome": "अपनी प्रोफ़ाइल पूरी करें",
  "onboarding.welcomeDesc": "जुड़ने के लिए बस कुछ जानकारी चाहिए",
  "onboarding.firstName": "पहला नाम",
  "onboarding.lastName": "अंतिम नाम का पहला अक्षर",
  "onboarding.email": "ईमेल पता",
  "onboarding.phone": "मोबाइल फ़ोन नंबर",
  "onboarding.phoneRequired": "एक वैध मोबाइल नंबर आवश्यक है",
  "onboarding.phoneInvalid": "कृपया एक वैध फ़ोन नंबर दर्ज करें",
  "onboarding.selectCountry": "देश चुनें",
  "onboarding.popularCountries": "लोकप्रिय देश",
  "onboarding.allCountries": "सभी देश",
  "onboarding.spokenLanguage": "आपकी प्राथमिक भाषा",
  "onboarding.autoDetect": "स्वतः पहचान (AI द्वारा निर्धारित)",
  "onboarding.next": "अगला",
  "onboarding.back": "वापस",
  "onboarding.skip": "छोड़ें",
  "onboarding.step": "चरण",
  "onboarding.of": "का",
  "onboarding.privacyTitle": "डेटा उपयोग और गोपनीयता",
  "onboarding.privacyDesc": "आपका डेटा निजी और एन्क्रिप्टेड है। हम कभी भी आपकी जानकारी साझा या बेचते नहीं हैं।",
  "onboarding.consentData": "मैं समझता/समझती हूं और सहमत हूं कि मेरा डेटा JunoTalk प्लेटफ़ॉर्म की कार्यक्षमता का समर्थन करता है।",
  "onboarding.consentPrivacy": "मैंने गोपनीयता नीति पढ़ ली है और इससे सहमत हूं।",
  "onboarding.dataSharingNotice": "आप किसी भी समय सेटिंग्स में अपनी डेटा शेयरिंग और कुकी प्राथमिकताएं बदल सकते हैं। यदि आप व्यक्तिगत विज्ञापनों के लिए डेटा साझा नहीं करना चाहते, तो साइन अप के बाद सेटिंग्स में जाएं।",
  "onboarding.getStarted": "शुरू करें",
  "onboarding.notifications": "संदेश सूचनाएं",
  "onboarding.notificationsDesc": "नए संदेश प्राप्त होने पर तुरंत अलर्ट पाएं",
  "onboarding.enableNotifications": "सूचनाएं सक्षम करें",
  "onboarding.skipNotifications": "अभी छोड़ें",
  "onboarding.completeSetup": "सेटअप पूरा करें",
  "onboarding.settingUp": "आपका खाता सेट किया जा रहा है...",
  "onboarding.nameRequired": "आपका पहला नाम आवश्यक है",
  "onboarding.emailRequired": "एक वैध ईमेल पता आवश्यक है",
  "onboarding.lastInitialRequired": "आपके अंतिम नाम का पहला अक्षर आवश्यक है",
  "onboarding.consentRequired": "जारी रखने के लिए आपको दोनों समझौतों पर सहमति देनी होगी",
  "onboarding.missingFields": "कृपया नीचे सभी आवश्यक फ़ील्ड भरें",
  "onboarding.agreeRequired": "जारी रखने के लिए आपको शर्तों से सहमत होना होगा",
  "onboarding.verifyPhone": "हम आपके खाते को सत्यापित करने में असमर्थ हैं",

  "settings.title": "सेटिंग्स",
  "settings.profile": "प्रोफ़ाइल",
  "settings.displayName": "प्रदर्शन नाम",
  "settings.phoneNumber": "फ़ोन नंबर",
  "settings.language": "भाषा",
  "settings.languageSettings": "भाषा सेटिंग्स",
  "settings.spokenLanguage": "मेरी बोली जाने वाली भाषा",
  "settings.subtitleLanguage": "उपशीर्षक अनुवाद करें",
  "settings.showOriginal": "मूल पाठ दिखाएं",
  "settings.showTranslated": "अनुवादित पाठ दिखाएं",
  "settings.autoDetect": "भाषा स्वतः पहचानें",
  "settings.save": "सेटिंग्स सहेजें",
  "settings.saved": "सेटिंग्स सहेजी गईं",
  "settings.saveError": "सेटिंग्स सहेजने में विफल",
  "settings.about": "जानकारी",
  "settings.version": "संस्करण",
  "settings.privacyPolicy": "गोपनीयता नीति",
  "settings.termsOfService": "सेवा की शर्तें",
  "settings.logOut": "लॉग आउट",
  "settings.logOutConfirm": "क्या आप वाकई लॉग आउट करना चाहते हैं?",
  "settings.deleteAccount": "खाता हटाएं",
  "settings.deleteAccountConfirm": "क्या आप वाकई अपना खाता हटाना चाहते हैं? यह क्रिया पूर्ववत नहीं की जा सकती।",
  "settings.editProfile": "प्रोफ़ाइल संपादित करें",
  "settings.changePhoto": "बदलने के लिए फ़ोटो पर टैप करें",
  "settings.developer": "डेवलपर",
  "settings.feedback": "प्रतिक्रिया",
  "settings.uiLanguage": "इंटरफ़ेस भाषा",

  "room.joinRoom": "रूम में शामिल हों",
  "room.leaveRoom": "रूम छोड़ें",
  "room.endCall": "कॉल समाप्त करें",
  "room.startCall": "कॉल शुरू करें",
  "room.roomCode": "रूम कोड",
  "room.copyCode": "कोड कॉपी करें",
  "room.codeCopied": "कोड कॉपी हो गया!",
  "room.shareLink": "लिंक शेयर करें",
  "room.participants": "प्रतिभागी",
  "room.captions": "कैप्शन",
  "room.captionsOn": "कैप्शन चालू",
  "room.captionsOff": "कैप्शन बंद",
  "room.settings": "सेटिंग्स",
  "room.chat": "चैट",
  "room.sendMessage": "भेजें",
  "room.messagePlaceholder": "संदेश टाइप करें...",
  "room.isTyping": "टाइप कर रहा है...",
  "room.areTyping": "टाइप कर रहे हैं...",
  "room.connecting": "कनेक्ट हो रहा है...",
  "room.connected": "कनेक्टेड",
  "room.disconnected": "डिस्कनेक्टेड",
  "room.reconnecting": "पुनः कनेक्ट हो रहा है...",
  "room.noOneHere": "अभी यहां कोई और नहीं है",
  "room.waitingForOthers": "दूसरों के शामिल होने की प्रतीक्षा...",
  "room.autoDelete24h": "संदेश आपके चैट इतिहास में सहेजे जाते हैं",
  "room.micOn": "म्यूट करें",
  "room.micOff": "अनम्यूट करें",
  "room.videoOn": "कैमरा बंद करें",
  "room.videoOff": "कैमरा चालू करें",
  "room.switchCamera": "कैमरा बदलें",
  "room.screenShare": "स्क्रीन शेयर करें",
  "room.translate": "अनुवाद करें",
  "room.translating": "अनुवाद हो रहा है...",
  "room.originalText": "मूल",
  "room.translatedText": "अनुवादित",
  "room.connectionError": "कनेक्शन त्रुटि",
  "room.connectionGood": "अच्छा",
  "room.connectionFair": "ठीक",
  "room.connectionPoor": "कमज़ोर",
  "room.connectionOffline": "ऑफ़लाइन",
  "room.captionsStarting": "उपशीर्षक शुरू हो रहे हैं...",
  "room.captionsActive": "उपशीर्षक सक्रिय",
  "room.captionsPartial": "उपशीर्षक सीमित",
  "room.captionsInactive": "उपशीर्षक बंद",
  "room.incomingVideoCall": "वीडियो कॉल आ रही है...",
  "room.acceptCall": "शामिल हों",
  "room.holdToRecord": "रिकॉर्ड करने के लिए दबाए रखें",
  "room.holdToRecordDesc": "वॉइस मैसेज रिकॉर्ड करने के लिए माइक बटन दबाए रखें",
  "room.deleteMessage": "हटाएं",
  "room.messageDeleted": "संदेश हटा दिया गया",
  "room.releaseToSend": "भेजने के लिए छोड़ें",
  "room.retryConnection": "कनेक्शन पुनः प्रयास करें",
  "room.callEnded": "कॉल समाप्त हुई",
  "room.roomNotFound": "रूम नहीं मिला",
  "room.roomFull": "यह रूम भरा हुआ है। एक रूम में एक समय में केवल 2 लोग हो सकते हैं।",
  "room.scanToJoin": "शामिल होने के लिए स्कैन करें",
  "room.roomExpired": "यह रूम समाप्त हो गया है",
  "room.joinedRoom": "शामिल हुए",
  "room.leftRoom": "रूम छोड़ दिया",
  "room.sameLanguage": "पहले से आपकी भाषा में है",
  "room.translated": "अनुवादित",
  "room.translationFailed": "अनुवाद विफल",
  "room.noTextToTranslate": "अनुवाद करने के लिए कोई पाठ नहीं",

  "support.title": "ग्राहक सहायता",
  "support.aiChat": "AI से पूछें",
  "support.submitTicket": "समस्या रिपोर्ट करें",
  "support.ticketHistory": "मेरे टिकट",
  "support.askQuestion": "JunoTalk के बारे में कुछ भी पूछें!",
  "support.chatPlaceholder": "अपना सवाल टाइप करें...",
  "support.category": "श्रेणी",
  "support.subject": "विषय",
  "support.description": "विवरण",
  "support.priority": "प्राथमिकता",
  "support.submit": "टिकट भेजें",
  "support.submitting": "भेजा जा रहा है...",
  "support.ticketSubmitted": "टिकट भेजा गया",
  "support.ticketError": "टिकट भेजने में विफल",
  "support.noTickets": "अभी कोई टिकट नहीं",
  "support.status": "स्थिति",
  "support.open": "खुला",
  "support.inProgress": "प्रगति में",
  "support.resolved": "हल किया गया",
  "support.closed": "बंद",
  "support.low": "कम",
  "support.medium": "मध्यम",
  "support.high": "उच्च",
  "support.critical": "गंभीर",
  "support.translation": "अनुवाद",
  "support.video": "वीडियो",
  "support.audio": "ऑडियो",
  "support.text": "टेक्स्ट / चैट",
  "support.account": "खाता",
  "support.other": "अन्य",

  "feedback.title": "समुदाय प्रतिक्रिया",
  "feedback.shareFeedback": "अपनी प्रतिक्रिया दें",
  "feedback.yourName": "आपका नाम",
  "feedback.yourComment": "आपकी टिप्पणी",
  "feedback.namePlaceholder": "आपका पहला नाम",
  "feedback.commentPlaceholder": "अपनी प्रतिक्रिया यहां लिखें...",
  "feedback.submit": "प्रतिक्रिया भेजें",
  "feedback.submitting": "भेजा जा रहा है...",
  "feedback.submitted": "आपकी प्रतिक्रिया के लिए धन्यवाद!",
  "feedback.submitError": "प्रतिक्रिया भेजने में विफल",
  "feedback.communityWall": "लोग क्या कह रहे हैं",
  "feedback.noFeedback": "अभी कोई प्रतिक्रिया नहीं",
  "feedback.showMore": "और दिखाएं",

  "common.cancel": "रद्द करें",
  "common.confirm": "पुष्टि करें",
  "common.delete": "हटाएं",
  "common.edit": "संपादित करें",
  "common.save": "सहेजें",
  "common.close": "बंद करें",
  "common.loading": "लोड हो रहा है...",
  "common.error": "त्रुटि",
  "common.success": "सफल",
  "common.retry": "पुनः प्रयास",
  "common.goHome": "होम पर जाएं",
  "common.search": "खोजें",
  "common.noResults": "कोई परिणाम नहीं मिला",
  "common.required": "आवश्यक",
  "common.optional": "वैकल्पिक",
  "common.yes": "हां",
  "common.no": "नहीं",
  "common.ok": "ठीक है",
  "common.comingSoon": "जल्द आ रहा है",
  "common.beta": "बीटा",
  "common.betaBanner": "यह एक बीटा संस्करण है। सुविधाएं अभी विकास में हैं।",

  "error.somethingWentWrong": "कुछ गलत हो गया",
  "error.tryAgain": "कृपया पुनः प्रयास करें",
  "error.goHome": "होम पर जाएं",
  "error.pageNotFound": "पेज नहीं मिला",
  "error.connectionLost": "कनेक्शन टूट गया",
  "error.reconnecting": "पुनः कनेक्ट हो रहा है...",
  "error.sessionExpired": "आपका सत्र समाप्त हो गया है। कृपया पुनः साइन इन करें।",
  "error.unauthorized": "आप इस पेज तक पहुंचने के लिए अधिकृत नहीं हैं",

  "home.voiceTranslation": "Juno",
  "home.activity": "गतिविधि",
  "home.mediaFeed": "मीडिया फ़ीड",
  "home.travelEsim": "यात्रा eSIM",
  "home.earning": "कमाई",


  "calls.videoType": "वीडियो",
  "calls.voiceType": "आवाज़",
};

const translations: Record<UILanguage, AppTranslations> = { en, es, fr, zh, hi };

function detectBrowserLanguage(): UILanguage {
  const browserLang = navigator.language?.split("-")[0]?.toLowerCase();
  if (browserLang && browserLang in translations) {
    return browserLang as UILanguage;
  }
  return "en";
}

function getInitialLocale(): UILanguage {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.uiLang);
    if (stored && stored in translations) {
      return stored as UILanguage;
    }
  } catch {}
  return detectBrowserLanguage();
}

interface I18nContextValue {
  t: (key: TranslationKey) => string;
  locale: UILanguage;
  setLocale: (lang: UILanguage) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<UILanguage>(getInitialLocale);

  const setLocale = useCallback((lang: UILanguage) => {
    setLocaleState(lang);
    try {
      localStorage.setItem(STORAGE_KEYS.uiLang, lang);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.uiLang, locale);
    } catch {}
  }, [locale]);

  const t = useCallback(
    (key: TranslationKey): string => {
      const dict = translations[locale];
      if (dict && key in dict) {
        return dict[key];
      }
      const fallback = translations.en;
      if (fallback && key in fallback) {
        return fallback[key];
      }
      return key;
    },
    [locale],
  );

  return (
    <I18nContext.Provider value={{ t, locale, setLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
}
