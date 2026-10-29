import { configureValidationMessages } from '@shared/config/validation-messages.config.js';

/**
 * Mensagens de validação em português, como na aplicação (o `SharedModule` as configura ao
 * ser carregado): um schema testado isoladamente produz o mesmo texto que a API devolve.
 */
configureValidationMessages();
