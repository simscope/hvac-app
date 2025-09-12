useEffect(() => {
  const fetchData = async () => {
    setLoading(true);
    setErr('');

    // 1) Заявка — устойчивый поиск
    const isUuid = /^[0-9a-fA-F-]{36}$/.test(id);
    const isNum  = /^\d+$/.test(id);

    let jobData = null;
    let jobErr  = null;

    if (isUuid) {
      ({ data: jobData, error: jobErr } = await supabase
        .from('jobs')
        .select('*')
        .eq('id', id)
        .maybeSingle());
    } else if (isNum) {
      ({ data: jobData, error: jobErr } = await supabase
        .from('jobs')
        .select('*')
        .eq('job_number', Number(id))
        .maybeSingle());
    }

    // запасной комбинированный поиск, если выше не нашли
    if (!jobData && !jobErr) {
      const { data: anyJobs, error: anyErr } = await supabase
        .from('jobs')
        .select('*')
        .or(`id.eq.${id},uid.eq.${id},uuid.eq.${id}`)
        .limit(1);
      jobErr  = anyErr || null;
      jobData = (anyJobs && anyJobs[0]) || null;
    }

    if (jobErr || !jobData) {
      console.error('jobs lookup failed', { id, jobErr, jobData });
      setErr('Не удалось загрузить заявку');
      setLoading(false);
      return;
    }

    setJob(jobData);

    // 2) Клиент — мягкий фолбэк
    let clientObj = {
      full_name: jobData.client_name || jobData.full_name || '',
      address:   jobData.client_address || jobData.address || '',
      phone:     jobData.client_phone || jobData.phone || '',
      email:     jobData.client_email || jobData.email || '',
    };

    if (jobData.client_id) {
      const { data: clientData } = await supabase
        .from('clients')
        .select('full_name,address,phone,email')
        .eq('id', jobData.client_id)
        .maybeSingle();
      if (clientData) {
        clientObj = {
          full_name: clientData.full_name || '',
          address:   clientData.address || '',
          phone:     clientData.phone || '',
          email:     clientData.email || '',
        };
      }
    }
    setClient(clientObj);

    // 3) Материалы (обратите внимание на колонку quantity)
    const keyForMaterials = isUuid ? id : jobData.id;  // materials.job_id -> UUID из jobs.id
    const { data: materialData } = await supabase
      .from('materials')
      .select('name, quantity, price')
      .eq('job_id', keyForMaterials);

    const initialRows = [
      { type: 'service', name: 'Labor',            qty: 1, price: Number(jobData.labor_price || 0) },
      { type: 'service', name: 'Service Call Fee', qty: 1, price: Number(jobData.scf || 0) },
      ...((materialData || [])).map((m) => ({
        type: 'material',
        name:  m.name || '',
        qty:   Number(m.quantity || 0),
        price: Number(m.price || 0),
      })),
    ];
    setRows(initialRows);

    setLoading(false);
  };

  fetchData();
}, [id]);
