import React from 'react';
const logo='/brand/bruff-inc.png';
const artwork=<img src={logo} alt="" width="1254" height="1254" decoding="async"/>;
export default function Brand(){return <div className="bruff-brand" role="img" aria-label="BRUFF INC."><span className="bruff-logo-full" aria-hidden="true">{artwork}</span><span className="bruff-logo-crop" aria-hidden="true"><span className="bruff-logo-mark">{artwork}</span><span className="bruff-logo-type">{artwork}</span></span><span className="bruff-brand-caption" aria-hidden="true">WORKSPACE</span></div>}
