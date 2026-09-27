export interface QueueTaskProcessor {
  type: string;
  process(task: { payload: any; jobId: string; id: string }): Promise<any>;

  /**
   * Marca como fallido el registro de dominio asociado a la tarea. Lo invoca el
   * runner cuando una tarea queda abandonada y se cierra sin reejecutarse, para
   * que el registro no quede pendiente para siempre.
   */
  markFailed?(payload: any): Promise<void>;
}
