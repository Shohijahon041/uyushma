-- Add IJARA to ExternalProvider enum and RENT_CONTRACT to ExternalRecordKind enum
ALTER TYPE "ExternalProvider" ADD VALUE IF NOT EXISTS 'IJARA';
ALTER TYPE "ExternalRecordKind" ADD VALUE IF NOT EXISTS 'RENT_CONTRACT';

