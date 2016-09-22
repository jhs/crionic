angular.module('starter.services', ['ionic'])

.factory('Location', function($q) {
  var geo = null
  var getter = null

  function getGeo() {
    if (getter)
      return getter

    var def = $q.defer()
    console.log('Add listener for ready')
    document.addEventListener('deviceready', ready, false)

    getter = def.promise
    return getter

    function ready() {
      geo = window.backgroundGeoLocation
      console.log('Device ready, geo can run now', geo)
      def.resolve(geo)
    }
  }

  function init() {
    console.log('Initialize Location')
    try {
    return getGeo()
      .then(configure)
      .then(function(geo) {
        // Run these simultaneously.
        //watch(geo)
        return check(geo)
      })
    } catch (er) {
      console.log('ERROR', er)
    }
  }

  var isConfigured = false
  function configure(geo) {
    if (isConfigured) {
      console.log('Geo already configured')
      return geo
    }

    console.log('Configure geo settings')
    // BackgroundGeolocation is highly configurable. See platform specific configuration options
    geo.configure(onLocation, onFail, {
        desiredAccuracy: 10,
        stationaryRadius: 20,
        distanceFilter: 30,
        maxLocations: 5,
        interval: 5 * 60 * 1000
        //interval: 5 * 1000
    })

    isConfigured = true
    return geo
  }

  function watch(geo) {
    console.log('watchLocationMode()')
    var def = $q.deferred
    geo.watchLocationMode(onOk, onError)
    return def.promise

    function onOk(enabled) {
      console.log('||||||||||||||||||||||||')
      console.log('watchLocationMode returned', enabled)
      if (enabled) {
        console.log('Location serices are enabled')
        // call backgroundGeolocation.start
        // only if user already has expressed intent to start service
      } else {
        // location service are now disabled or we don't have permission
        // time to change UI to reflect that
      }

      def.resolve(geo)
    }

    function onError(error) {
      console.log('Error watching location mode. Error:' + error);
      def.reject(error)
    }
  }

  function check(geo) {
    console.log('||||||||||||||||||||| check')
    geo.isLocationEnabled(onOk, onErr)
    return geo

    function onOk(enabled) {
      console.log('isLocationEnabled returned', enabled)
      if (enabled) {
        geo.start(onStarted, onStartErr)
      } else {
        console.log('Location services disabled')
        // Location services are disabled
        if (window.confirm('Location is disabled. Would you like to open location settings?', 'hi')) {
          backgroundGeolocation.showLocationSettings();
        }
      }
    }

    function onErr(er) {
      console.log('Check error', er)
    }
  }

  function onStarted() {
    console.log('Service started successfully')
    // you should adjust your app UI for example change switch element to indicate
    // that service is running
  }

  function onStartErr(error) {
    console.log('Start error', error)
    // Tracking has not started because of error
    // you should adjust your app UI for example change switch element to indicate
    // that service is not running
    if (error.code === 2) {
      if (window.confirm('Not authorized for location updates. Would you like to open app settings?')) {
        backgroundGeolocation.showAppSettings();
      }
    } else {
      window.alert('Start failed: ' + error.message);  
    }
  }

  function onLocation(loc) {
    console.log('Yay! Location =', JSON.stringify(loc))
    geo.finish()
  }

  function onFail(er) {
    console.log('backgroundGeolocation error:', er)
  }

  return {geo:getGeo, init:init}
})

.factory('DB', function($q) {
  var key_user = 'merstrockesserallicatigh'
  var key_pass = '3991455f205673b6dcf9d01bef7ffa8647e76928'
  var crimes_origin = new PouchDB('https://'+key_user+':'+key_pass+'@opendata.cloudant.com/crimes')
  var crimes = new PouchDB('crimes')
  var noop = function() {}

  // Use this quick and dirty Txn workalike.
  crimes.txn = txn
  crimes.pull = pull_replicate

  var inFlightPull = null
  var CONFIG_ID = 'config'

  return {crimes:crimes, txn:txn, noop:noop, pullCrimes:pullCrimes, CONFIG_ID:CONFIG_ID, nearby:findNearby}

  function findNearby(latitude, longitude, range) {
    console.log('Find nearby crimes')
    return makeDDoc().then(function() {
      range = range || 0.1
      var lat = {startkey:latitude - range, endkey:latitude + range}
      var lon = {startkey:longitude- range, endkey:longitude+ range}

      var rows = {}
      lat = crimes.query('crimes/latitude', lat).then(function(res) { rows.lat = res.rows })
      lon = crimes.query('crimes/longitude', lon).then(function(res) { rows.lon = res.rows })

      return $q.all([lat, lon]).then(function() {
        console.log('Compare %s latitude and %s longitude matches', rows.lat.length, rows.lon.length)

        // Find docs that ended up in both views.
        var latIds = {}
        rows.lat.forEach(function(row) {
          console.log('Doc within latitude range: %s', row.id)
          latIds[row.id] = true
        })

        var docs = []
        rows.lon.forEach(function(row) {
          var doc = row.value
          if (latIds[doc._id]) {
            console.log('Found neary doc: %s', doc._id)
            docs.push(doc)
          }
        })

        console.log('Yay everything is done. Results', docs)
        return docs
      })
    })
  }

  function makeDDoc() {
    return crimes.txn({id:'_design/crimes', create:true}, mk_ddoc)

    function mk_ddoc(ddoc) {
      ddoc.views = {
        latitude: {
          map: function(doc) {
            if (doc.geometry && doc.geometry.coordinates)
              emit(doc.geometry.coordinates[1], doc)
          }.toString()
        },
        longitude: {
          map: function(doc) {
            if (doc.geometry && doc.geometry.coordinates)
              emit(doc.geometry.coordinates[0], doc)
          }.toString()
        }
      }
    }
  }

  function pull_replicate(sourceUrl, opts) {
    opts = opts || {}

    console.log('Replicate from:', sourceUrl, opts)
    var rep = PouchDB.replicate(sourceUrl, this, opts)

    rep.on('error', function(er) {
      console.log('Pull error', sourceUrl, er)
    })
    rep.on('active', function() {
      console.log('Pull is active', sourceUrl)
    })
    //rep.on('change', function(info) {
    //  console.log('Change in pull', sourceUrl, info)
    //})
    rep.on('complete', function(info) {
      console.log('Pull complete', sourceUrl, info)
    })

    return rep
  }

  function pullCrimes() {
    if (inFlightPull) {
      console.log('pullCrimes: Return in-flight pull')
      return inFlightPull
    }

    console.log('pullCrimes: begin')
    var deferred = $q.defer()
    inFlightPull = deferred.promise

    getLastSeq()
      .then(findLatest)
      .then(replicate_view)

    return deferred.promise

    function getLastSeq() {
      console.log('Find last_seq for new crimes replication')
      return crimes.txn({id:CONFIG_ID, create:true}, noop)
      .then(function(config) {
        console.log('Config is', config)
        return config.last_seq
      })
    }

    function findLatest(last_seq) {
      // Figure out the timestamp of "one week ago."
      var oneWeekAgo = new Date
      oneWeekAgo.setUTCDate(oneWeekAgo.getUTCDate() - 7)
      oneWeekAgo = oneWeekAgo.valueOf()

      var viewName = 'view/cityTime'
      var lookup =
        { reduce: false
        //, stale: 'ok'
        , start_key: ['Boston', oneWeekAgo ]
        , end_key  : ['Boston', {}         ]
        }

      console.log('Query view %s', viewName, lookup)
      return crimes_origin.query(viewName, lookup)
      .then(function(result) {
        return {last_seq:last_seq, view:result}
      })
    }

    function replicate_view(db) {
      console.log('Replicate docs found in view: %s', db.view.rows.length)
      //for (var X of db.view.rows)
      //  console.log('Days since %s stamped at %s: %s', X.id, X.key[1], (new Date - X.key[1]) / 1000 / 60 / 60 / 24)

      var okCount = db.view.rows.length
      var okIds = db.view.rows.map(function(row) { return row.id })

      var seen = 0
      function isGoodDocId(doc) {
        seen += 1
        if (seen % 10 == 0 && puller)
          puller.emit('filter-seen', seen, okCount)

        return true
      }

      var opts =
        { filter    : isGoodDocId
        , query_params: { bustTheCache: Math.random() }
        , batch_size: 10
        , doc_ids   : okIds
        , timeout   : 5 * 60 * 1000
        }

      if (db.last_seq)
        opts.since = db.last_seq

      console.log('Begin pull %s docs from %s', okCount, crimes_origin, opts)

      var puller = crimes.pull(crimes_origin, opts)
      puller.on('complete', pullComplete)
      puller.on('error', pullError)
      return deferred.resolve({puller:puller})

      function pullComplete(info) {
        console.log('Clear in-flight pull after successful replication', info)
        inFlightPull = null
      }

      function pullError(er) {
        console.log('Clear in-flight pull after replication error', er)
        inFlightPull = null
      }

    }
  }

  // A quick and dirty TXN clone.
  function txn(opts, operation) {
    var db = this
    var deferred = $q.defer()

    go(0)
    return deferred.promise

    function go(i) {
      i += 1
      if (i > 5)
        return deferred.reject(new Error('Failed to update '+opts.id+' after '+i+' iterations'))

      if (typeof opts == 'string')
        opts = {id:opts}

      db.get(opts.id, function(er, doc) {
        if (er && er.status == 404 && opts.create)
          doc = {_id:opts.id}
        else if (er)
          return deferred.reject(er)

        var before = JSON.stringify(doc)
        var op_handled = false

        try { operation(doc, op_done) }
        catch (er) { return deferred.reject(er) }

        if (! op_handled)
          op_done() // The operation function did not call the callback

        function op_done(er) {
          op_handled = true
          //console.log('txn: op_done')

          if (er)
            return deferred.reject(er)

          var after = JSON.stringify(doc)
          if (before == after) {
            //console.log('Skip no-op change:', doc._id)
            return deferred.resolve(doc)
          }

          doc.updated_at = new Date
          doc.created_at = doc.created_at || doc.updated_at

          db.put(doc, function(er, res) {
            if (er)
              return deferred.reject(er)

            doc._rev = res.rev
            deferred.resolve(doc)
          })
        }
      })
    } // go
  }
});
