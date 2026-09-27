/**
 * Resultado del movimiento de fondos asociado a un registro. Lo comparten la
 * contribución y el fondeo del proyecto porque describen lo mismo: si el dinero
 * se movió, todavía no, o no se movió.
 *
 * En los flujos que resuelven la transferencia dentro de la propia petición el
 * único valor alcanzable es DONE: si la transferencia falla, la excepción impide
 * que el registro llegue a existir.
 */
export enum TransferStatus {
  PENDING = "pending",
  DONE = "done",
  FAILED = "failed",
}
