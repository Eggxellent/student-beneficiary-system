/** Forward Express 4 route-handler failures to the error middleware. */
function asyncHandler(handler) {
  return function wrappedAsyncHandler(req, res, next) {
    let errorForwarded = false;
    const callNext = (error) => {
      try {
        next(error);
      } catch (forwardingError) {
        // The error has already been handed to Express; don't recursively forward
        // an exception raised while Express is processing it.
        console.error('Request error forwarding failed');
      }
    };
    const forwardErrorOnce = (reason) => {
      if (errorForwarded) return;
      errorForwarded = true;
      callNext(reason || new Error('Request handler failed'));
    };
    const handlerNext = (error) => {
      if (error) return forwardErrorOnce(error);
      callNext(error);
    };

    try {
      Promise.resolve(handler(req, res, handlerNext)).catch(forwardErrorOnce);
    } catch (error) {
      forwardErrorOnce(error);
    }
  };
}

module.exports = asyncHandler;
