const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route params are user input: queries return "not found" for anything that is not a UUID. */
export const isUuid = (value: string) => UUID.test(value);
