import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

export function IsAssetIdentifier(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isAssetIdentifier',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(_: any, args: ValidationArguments) {
          const obj = args.object as any;
          const hasId = !!obj.id;
          const hasChainId = !!obj.chainId;
          const hasBlockchain = !!obj.blockchain;

          return hasId || (hasChainId && hasBlockchain);
        },
      },
    });
  };
}
