import { Service } from '@n8n/di';
import axios, { AxiosError } from 'axios';
import { Logger } from 'n8n-core';
import { ensureError } from 'n8n-workflow';

import type { User } from '@/databases/entities/user';
import { WorkflowRepository } from '@/databases/repositories/workflow.repository';
import { BadRequestError } from '@/errors/response-errors/bad-request.error';
import { EventService } from '@/events/event.service';
import { License } from '@/license';
import { UrlService } from '@/services/url.service';

type LicenseError = Error & { errorId?: keyof typeof LicenseErrors };

export const LicenseErrors = {
	SCHEMA_VALIDATION: 'Activation key is in the wrong format',
	RESERVATION_EXHAUSTED: 'Activation key has been used too many times',
	RESERVATION_EXPIRED: 'Activation key has expired',
	NOT_FOUND: 'Activation key not found',
	RESERVATION_CONFLICT: 'Activation key not found',
	RESERVATION_DUPLICATE: 'Activation key has already been used on this instance',
};

@Service()
export class LicenseService {
	constructor(
		private readonly logger: Logger,
		private readonly license: License,
		private readonly workflowRepository: WorkflowRepository,
		private readonly urlService: UrlService,
		private readonly eventService: EventService,
	) {}

	async getLicenseData() {
		return {
			usage: {
				activeWorkflowTriggers: {
					value: 0,
					limit: Infinity,
					warningThreshold: 0.8,
				},
			},
			license: {
				planId: 'enterprise',
				planName: 'Enterprise',
			},
		};
	}

	async requestEnterpriseTrial(user: User) {
		await axios.post('https://enterprise.n8n.io/enterprise-trial', {
			licenseType: 'enterprise',
			firstName: user.firstName,
			lastName: user.lastName,
			email: user.email,
			instanceUrl: this.urlService.getWebhookBaseUrl(),
		});
	}

	async registerCommunityEdition({
		userId,
		email,
		instanceId,
		instanceUrl,
		licenseType,
	}: {
		userId: User['id'];
		email: string;
		instanceId: string;
		instanceUrl: string;
		licenseType: string;
	}): Promise<{ title: string; text: string }> {
		try {
			const {
				data: { licenseKey, ...rest },
			} = await axios.post<{ title: string; text: string; licenseKey: string }>(
				'https://enterprise.n8n.io/community-registered',
				{
					email,
					instanceId,
					instanceUrl,
					licenseType,
				},
			);
			this.eventService.emit('license-community-plus-registered', { userId, email, licenseKey });
			return rest;
		} catch (e: unknown) {
			if (e instanceof AxiosError) {
				const error = e as AxiosError<{ message: string }>;
				const errorMsg = error.response?.data?.message ?? e.message;
				throw new BadRequestError('Failed to register community edition: ' + errorMsg);
			} else {
				this.logger.error('Failed to register community edition', { error: ensureError(e) });
				throw new BadRequestError('Failed to register community edition');
			}
		}
	}

	getManagementJwt(): string {
		return 'valid-jwt-token';
	}

	async activateLicense(activationKey: string) {
		this.logger.debug('License activation bypassed, returning success');
		return true;
	}

	async renewLicense() {
		this.logger.debug('License renewal bypassed, returning success');
		this.eventService.emit('license-renewal-attempted', { success: true });
		return true;
	}

	private mapErrorMessage(error: LicenseError, action: 'activate' | 'renew') {
		let message = error.errorId && LicenseErrors[error.errorId];
		if (!message) {
			message = `Failed to ${action} license: ${error.message}`;
			this.logger.error(message, { stack: error.stack ?? 'n/a' });
		}
		return message;
	}
}
