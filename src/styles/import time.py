import time
import collections

class PCB:
    def __init__ (self,pid,nombre,tiempo_ejecucion):
        self.pid = pid
        self.pid = nombre
        self.pid = tiempo_ejecucion
        self.pid = "LISTO"

cola_de_listos = collections.deque([
    PCB(1, "Navegador", 5),
    PCB(2, "IDE Visual Studio",8),
    PCB(3, "Spotify",3)

])

print ("---Iniciando Simulacion de CPU---")
while cola_de_listos:
    proceso_actual= cola_de_listos.popleft()
    proceso_actual.estado= "EJECUTANDO"

    print(f"Ejecutando {proceso_actual.nombre}(PID:{proceso_actual.pid})...")
    time.sleep(1)
    proceso_actual.tiempo_restante -=1

    if proceso_actual.tiempo_restante > 0:
        proceso_actual.estado = "LISTO"
        cola_de_listos.append(proceso_actual)

        print(f"->{proceso_actual.nombre} vuelve a la cola. Falta: {proceso_actual.tiempo_restante}s")

    else:
        print(f"{proceso_actual.nombre} Finalizado.")

print("---todas las tareas completadas---")