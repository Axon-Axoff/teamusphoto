// =====================================================================================================
// (iddi)  Input -> DropDown -> Input
// =====================================================================================================
// >>> Configuration <<<
// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

const iddi_elementary_pairs_A = [
  [ 'id_people', 'dd_people' ],
  [ 'id_tags', 'dd_tags' ] ];

const iddi_spacer_text_S = '~~~~~~~~~~~~~~~~~~~~';
const iddi_spacer_color_S = 'blue';

// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

const iddi_data_A = {};
for ( let elmnt_id of iddi_elementary_pairs_A ) {
  let terms = {};
  terms['input_E'] = document.getElementById( elmnt_id[0] );
  terms['dropdown_E'] = document.getElementById( elmnt_id[1] );
  let dd = terms['dropdown_E'];
  terms['ucterms_A'] = [];
  for ( let option of dd.options ) {
    terms['ucterms_A'].push( option.text );
  }
  iddi_data_A[ elmnt_id[0] ] = terms;
  iddi_data_A[ elmnt_id[1] ] = terms;
  terms['input_E'].addEventListener( 'keydown', iddi_input_keydown );
  terms['input_E'].addEventListener( 'keyup', iddi_input_keyup );
  terms['dropdown_E'].addEventListener( 'click', iddi_dropdown_click );
}

// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
// Functions
// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

function iddi_dropdown_click( evnt ) {

  let data_A = iddi_data_A[ evnt.target.id ];

  let selected_item = data_A['dropdown_E'].value;

  let current_input_A = data_A[ 'input_E' ].value.split(',');

  let srch_txt = current_input_A[current_input_A.length-1].trim();

  if ( ! srch_txt in data_A[ 'ucterms_A' ] ) current_input_A.push( selected_item );
  else current_input_A[current_input_A.length-1] = selected_item;

  data_A[ 'input_E' ].value = current_input_A.join(',')+',';

  iddi_update_dd( evnt );
  data_A[ 'input_E' ].focus();

}

// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

function iddi_input_keydown( evnt ) {

  if ( evnt.code == 'Insert' ) iddi_dropdown_click( evnt );

}

// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

function iddi_input_keyup( evnt ) {

  let data_A = iddi_data_A[ evnt.target.id ];

  let current_input_A = data_A[ 'input_E' ].value.split(',');

  let uc_terms_A = [];
  let lc_terms_A = [];
  for ( let ucterm of data_A[ 'ucterms_A' ] ) {
    if ( ! current_input_A.includes( ucterm ) ) {
      uc_terms_A.push( ucterm );
      lc_terms_A.push( ucterm.toLowerCase() );
    }
  }

  let rtrn_A = uc_terms_A;

  let srch_txt = current_input_A[current_input_A.length-1].toLowerCase().trim();

  if ( srch_txt.length > 0 ) {

    let hits = [ [], [] ];

    for ( let term_id in lc_terms_A ) {

      let lc_words = lc_terms_A[ term_id ].replace( '-', ' ' ).split( ' ' );
      if ( srch_txt.search( ' ' ) >= 0 ) lc_words = [ lc_terms_A[ term_id ] ];

      let fnd = [ false, false ];

      for ( let word_id in lc_words ) {

        let plc_id = lc_words[word_id].search( srch_txt );
        if ( plc_id >= 0 ) {

          fnd[0] = true;

          if ( plc_id == 0 ) {

            fnd[1] = true;

            break;
          }
        }
      }

      if ( fnd[0] ) {

        if ( fnd[1] ) hits[1].push( uc_terms_A[term_id] );

        else hits[0].push( uc_terms_A[term_id] );
      }
    }

    let spacer = [];
    if ( hits[0].length > 0 && hits[1].length > 0 ) spacer = [ iddi_spacer_text_S ];

    rtrn_A = hits[1].concat( spacer, hits[0] );
  }

  iddi_update_dd( evnt, rtrn_A );

}

// ----------------------------------------------------------------------------------------------------

function iddi_update_dd( evnt, new_vals_A=null ) {

  let data_A = iddi_data_A[ evnt.target.id ];

  let potentials_A = new_vals_A != null ? new_vals_A : data_A[ 'ucterms_A' ];

  let used_terms_A = data_A[ 'input_E' ].value.split(',');

  let dropdown_E = data_A[ 'dropdown_E' ];

  while ( dropdown_E.length > 0 ) dropdown_E.remove(0);

  let new_options = [];
  for ( let potential of potentials_A )
    if ( ! used_terms_A.includes( potential ) )
      new_options.push( potential );

  for ( let txt of new_options ) {
    var option = document.createElement('option');
    option.text = txt;
    if ( txt == iddi_spacer_text_S ) {
      option.disabled = true;
      option.style = 'color:'+iddi_spacer_color_S;
    }
    dropdown_E.add( option );
  }

}
