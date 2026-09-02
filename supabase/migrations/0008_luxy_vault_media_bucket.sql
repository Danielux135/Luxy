-- 0008: almacen de los bytes de imagenes y videos privados.
--
-- La 0007 crea la tabla `vault_media`, que dice DONDE esta cada archivo y como
-- abrirlo. Los bytes no caben ahi: un video de decenas de megas en una columna
-- jsonb es una mala idea por donde se mire. Van a un bucket de Supabase
-- Storage, ya cifrados desde el equipo del usuario.
--
-- Por que Supabase Storage y no R2: el gateway YA tiene la URL y la service
-- role key de este proyecto. R2 obligaria a un binding nuevo en `wrangler.toml`
-- —que ni siquiera se versiona— y a un despliegue distinto, a cambio de nada
-- que se note desde Luxy.
--
-- El bucket es PRIVADO y se queda SIN POLITICAS, igual que las tablas `vault_*`
-- de la 0007. Sin politicas y con RLS activo sobre `storage.objects`, nadie que
-- no sea `service_role` ve un solo archivo. El acceso pasa siempre por el
-- gateway, que comprueba en `vault_media` de que usuario es cada objeto antes
-- de tocar el almacen.
--
-- Lo que el servidor ve de cada archivo: que existe, cuanto ocupa, de que
-- usuario es y cuando se subio. Nunca su contenido, ni su tipo, ni su nombre:
-- eso viaja cifrado dentro de `vault_media.content`.

-- -----------------------------------------------------------------------------
-- el bucket
--
-- `public = false` es lo importante: con `true`, cualquiera con la URL podria
-- descargar el ciphertext. No lo podria abrir, pero tampoco hay razon para
-- regalarle el archivo ni el metadato de que existe.
--
-- Sin limite de tamaño ni lista de tipos MIME: todos los objetos son
-- `application/octet-stream` opacos, y el limite real lo impone el gateway
-- (VAULT_MAX_OBJECT_BYTES), que es quien puede dar un mensaje util cuando un
-- archivo no cabe.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('vault-media', 'vault-media', false)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- seguridad
--
-- `storage.objects` ya trae RLS activo en Supabase. No se crea ninguna politica
-- para este bucket a proposito: es la misma decision que en la 0007, y por el
-- mismo motivo. Si algun dia hiciera falta que un cliente lea directamente,
-- entonces se escribira una politica y se razonara aqui; mientras tanto, no
-- existe ninguna via que no pase por el gateway.
--
-- Esta comprobacion no cambia nada; esta para que quien lea la migracion vea
-- que el estado esperado es "RLS activo, cero politicas para este bucket".
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_tables
    where schemaname = 'storage' and tablename = 'objects' and rowsecurity
  ) then
    raise exception 'storage.objects no tiene RLS activo: revisar antes de continuar';
  end if;
end
$$;
